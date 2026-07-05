import "reflect-metadata";
import { MikroORM } from "@mikro-orm/postgresql";
import {
  Entity,
  Embeddable,
  Embedded,
  Property,
  PrimaryKey,
  OneToOne,
} from "@mikro-orm/decorators/legacy";

@Embeddable()
class CommentTemplate {
  @Property({ fieldName: "comment_template", type: "varchar" })
  value: string;

  constructor(value: string) {
    this.value = value;
  }
}

@Entity()
class Child {
  @PrimaryKey({ type: "uuid" })
  id!: number;

  @Embedded(() => CommentTemplate, { prefix: false, nullable: true })
  commentTemplate: CommentTemplate | null = null;
}

@Entity()
class Parent {
  @PrimaryKey({ type: "uuid" })
  id!: number;

  @OneToOne(() => Child)
  child!: Child;
}

async function main() {
  const orm = await MikroORM.init({
    entities: [Parent, Child],
    host: "localhost",
    port: 5433,
    user: "test",
    password: "test",
    dbName: "test",
    debug: true,
  });

  const conn = orm.em.getConnection();
  await conn.execute('drop table if exists "child" cascade');
  await conn.execute('drop table if exists "parent" cascade');
  await conn.execute(`
    create table "child" (
      "id" int not null primary key,
      "comment_template" varchar null
    )
  `);
  await conn.execute(`
    create table "parent" (
      "id" int not null primary key,
      "child_id" int not null references "child" ("id")
    )
  `);

  // наполняем базу тестовыми данными
  const em1 = orm.em.fork();
  const child = em1.create(Child, {
    id: 1,
    commentTemplate: new CommentTemplate("hello"),
  });
  const parent = em1.create(Parent, { id: 1, child });
  em1.persist(parent);
  await em1.flush();

  // воспроизводим баг
  const em2 = orm.em.fork();
  // Смените strategy на 'select-in', чтобы увидеть, что баг пропадает —
  // это и есть обходной путь, описанный в issue.
  const found = await em2.findOne(
    Parent,
    { id: 1 },
    { populate: ["child"], strategy: "joined" },
  );

  console.log("hydrated value:", found?.child.commentTemplate); // CommentTemplate { value: 'hello' } — корректно

  // смотрим changeset ДО flush, чтобы понять, есть ли фантомное изменение,
  // не дожидаясь реального падения на INSERT/UPDATE
  const uow = (em2 as any).getUnitOfWork();
  uow.computeChangeSets();
  console.log("--- changesets before flush ---");
  console.dir(
    uow.getChangeSets().map((cs: any) => ({
      entityName: cs.entity?.constructor?.name,
      type: cs.type,
      payload: cs.payload,
    })),
    { depth: 5 },
  );

  console.log("--- calling flush() with no changes made ---");
  await em2.flush(); // 💥 ожидаем: DriverException: No data provided

  console.log("flush succeeded without error (bug NOT reproduced)");

  await orm.close();
}

main().catch((err) => {
  console.error("flush failed as expected (bug reproduced):", err);
});
