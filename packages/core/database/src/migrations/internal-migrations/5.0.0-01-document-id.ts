import { createId } from '@paralleldrive/cuid2';
import type { Knex } from 'knex';

import type { Migration } from '../common';
import type { Database } from '../..';
import type { Meta } from '../../metadata';

interface Params {
  joinColumn: string;
  inverseJoinColumn: string;
  tableName: string;
  joinTableName: string;
}

const QUERIES = {
  async postgres(knex: Knex, params: Params) {
    const res = await knex.raw(
      `
    SELECT :tableName:.id as id, string_agg(DISTINCT :inverseJoinColumn:::character varying, ',') as other_ids
    FROM :tableName:
    LEFT JOIN :joinTableName: ON :tableName:.id = :joinTableName:.:joinColumn:
    WHERE document_id IS NULL
    GROUP BY :tableName:.id, :joinColumn:
    LIMIT 1;
  `,
      params
    );

    return res.rows;
  },
  async mysql(knex: Knex, params: Params) {
    const [res] = await knex.raw(
      `
    SELECT :tableName:.id as id, group_concat(DISTINCT :inverseJoinColumn:) as other_ids
    FROM :tableName:
    LEFT JOIN :joinTableName: ON :tableName:.id = :joinTableName:.:joinColumn:
    WHERE document_id IS NULL
    GROUP BY :tableName:.id, :joinColumn:
    LIMIT 1;
  `,
      params
    );

    return res;
  },
  async sqlite(knex: Knex, params: Params) {
    return knex.raw(
      `
    SELECT :tableName:.id as id, group_concat(DISTINCT :inverseJoinColumn:) as other_ids
    FROM :tableName:
    LEFT JOIN :joinTableName: ON :tableName:.id = :joinTableName:.:joinColumn:
    WHERE document_id IS NULL
    GROUP BY :joinColumn:
    LIMIT 1;
    `,
      params
    );
  },
};

const getNextIdsToCreateDocumentId = async (
  db: Database,
  knex: Knex,
  {
    joinColumn,
    inverseJoinColumn,
    tableName,
    joinTableName,
  }: {
    joinColumn: string;
    inverseJoinColumn: string;
    tableName: string;
    joinTableName: string;
  }
): Promise<number[]> => {
  const res = await QUERIES[db.dialect.client as keyof typeof QUERIES](knex, {
    joinColumn,
    inverseJoinColumn,
    tableName,
    joinTableName,
  });

  if (res.length > 0) {
    const row = res[0];
    const otherIds = row.other_ids
      ? row.other_ids.split(',').map((v: string) => parseInt(v, 10))
      : [];

    return [row.id, ...otherIds];
  }

  return [];
};

// Migrate document ids for tables that have localizations
const migrateDocumentIdsWithLocalizations = async (db: Database, knex: Knex, meta: Meta) => {
  const joinColumn = `${meta.singularName.toLowerCase()}_id`;
  const inverseJoinColumn = `inv_${meta.singularName.toLowerCase()}_id`;

  let ids: number[];

  do {
    ids = await getNextIdsToCreateDocumentId(db, knex, {
      joinColumn,
      inverseJoinColumn,
      tableName: meta.tableName,
      joinTableName: `${meta.tableName}_localizations_links`,
    });

    if (ids.length > 0) {
      await knex(meta.tableName).update({ document_id: createId() }).whereIn('id', ids);
    }
  } while (ids.length > 0);
};

// Migrate document ids for tables that don't have localizations
const migrationDocumentIds = async (db: Database, knex: Knex, meta: Meta) => {
  let res;
  do {
    res = await knex.select('id').from(meta.tableName).whereNull('document_id').limit(1).first();

    if (res) {
      await knex(meta.tableName).update({ document_id: createId() }).whereIn('id', res.id);
    }
  } while (res !== null);
};

const createDocumentIdColumn = async (knex: Knex, tableName: string) => {
  await knex.schema.alterTable(tableName, (table) => {
    table.string('document_id');
  });
};

const hasLocalizationsJoinTable = async (knex: Knex, tableName: string) => {
  return knex.schema.hasTable(`${tableName}_localizations_links`);
};

export const createdDocumentId: Migration = {
  name: 'created-document-id',
  async up(knex, db) {
    for (const meta of db.metadata.values()) {
      const hasTable = await knex.schema.hasTable(meta.tableName);

      if (!hasTable) {
        continue;
      }

      if ('documentId' in meta.attributes) {
        // add column if doesn't exist
        const hasDocumentIdColumn = await knex.schema.hasColumn(meta.tableName, 'document_id');

        if (hasDocumentIdColumn) {
          continue;
        }

        await createDocumentIdColumn(knex, meta.tableName);

        if (await hasLocalizationsJoinTable(knex, meta.tableName)) {
          await migrateDocumentIdsWithLocalizations(db, knex, meta);
        } else {
          await migrationDocumentIds(db, knex, meta);
        }
      }
    }
  },
  async down() {
    throw new Error('not implemented');
  },
};