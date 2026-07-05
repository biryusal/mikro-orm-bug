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
  // Change to commenttemplate (without _) and bug will disappear with the default [joined] stategy
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
  // seed the database with test data
  const em1 = orm.em.fork();
  const child = em1.create(Child, {
    id: 1,
    commentTemplate: new CommentTemplate("hello"),
  });
  const parent = em1.create(Parent, { id: 1, child });
  em1.persist(parent);
  await em1.flush();
  // reproduce the bug
  const em2 = orm.em.fork();
  // Change strategy to 'select-in' to see the bug disappear —
  // this is the workaround described in the issue.
  const found = await em2.findOne(
    Parent,
    { id: 1 },
    { populate: ["child"], strategy: "joined" },
  );
  console.log("hydrated value:", found?.child.commentTemplate); // CommentTemplate { value: 'hello' } — correct
  // inspect the changeset BEFORE flush to see the phantom change,
  // without waiting for the actual INSERT/UPDATE to fail
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
  await em2.flush(); // 💥 expected: DriverException: No data provided
  console.log("flush succeeded without error (bug NOT reproduced)");
  await orm.close();
}
main().catch((err) => {
  console.error("flush failed as expected (bug reproduced):", err);
});
