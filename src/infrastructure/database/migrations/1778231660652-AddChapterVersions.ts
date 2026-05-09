import { MigrationInterface, QueryRunner } from "typeorm";

export class AddChapterVersions1778231660652 implements MigrationInterface {
    name = 'AddChapterVersions1778231660652'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "chapter_versions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chapter_id" character varying NOT NULL, "version_number" integer NOT NULL, "content" text NOT NULL, "word_count" integer NOT NULL DEFAULT '0', "context_summary" text, "continuity_issues" jsonb, "reason" character varying(32) NOT NULL, "note" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_1061552b3c7c8c3dc04461aef8c" UNIQUE ("chapter_id", "version_number"), CONSTRAINT "PK_59bebbe36f227c5b4fdb1a34745" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b0c37709e345ac411720254bc9" ON "chapter_versions" ("chapter_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_b0c37709e345ac411720254bc9"`);
        await queryRunner.query(`DROP TABLE "chapter_versions"`);
    }

}
