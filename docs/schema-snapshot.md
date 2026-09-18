# Schema snapshot

Generated 2026-09-18 07:05 UTC by `agent/scripts/dump_schema.py`.

- oracleagentmemory: **26.6.0**
- oracledb (python): 4.0.2
- Database: Oracle AI Database Free 23.26.3.0.0
- Schema: `AIM_APP`
- Embedding model: `ollama/nomic-embed-text`

Do not edit by hand. Rerun after any package version bump and diff.

## Tables and row counts

| table | rows |
|---|---|
| ACTOR_PROFILE | 0 |
| MEMORY | 33 |
| MESSAGE | 22 |
| ORACLEAGENTMEMORY_SCHEMA_META | 4 |
| RECORD_CHUNKS | 55 |
| THREAD | 3 |

Plus 3 vector index internal tables (`VECTOR$<index>$<object ids>$HNSW_*`), omitted below.

## Package schema metadata

| key | value |
|---|---|
| memory_retention_config | {"default_ttl_days":null,"max_ttl_days":null} |
| record_chunks_indexing_mode | vector |
| schema_version | 12 |
| vector_dim | 768 |

### ACTOR_PROFILE

| column | type | length | precision | scale | nullable | default |
|---|---|---|---|---|---|---|
| ACTOR_ID | VARCHAR2 | 128 |  |  | N |  |
| ACTOR_TYPE | VARCHAR2 | 30 |  |  | N |  |
| SPACE_ID | VARCHAR2 | 128 |  |  | Y |  |
| ORDER_SEQ | NUMBER | 22 |  |  | N | "AIM_APP"."ISEQ$$_73774".nextval |
| INFORMATION | CLOB | 4000 |  |  | N |  |
| METADATA | JSON | 8200 |  |  | Y |  |
| CREATED_AT | TIMESTAMP(6) WITH TIME ZONE | 13 |  | 6 | N | SYSTIMESTAMP  |

### MEMORY

| column | type | length | precision | scale | nullable | default |
|---|---|---|---|---|---|---|
| RECORD_ID | VARCHAR2 | 128 |  |  | N |  |
| ORDER_SEQ | NUMBER | 22 |  |  | N | "AIM_APP"."ISEQ$$_73796".nextval |
| THREAD_ID | VARCHAR2 | 128 |  |  | Y |  |
| USER_ID | VARCHAR2 | 128 |  |  | Y |  |
| AGENT_ID | VARCHAR2 | 128 |  |  | Y |  |
| SPACE_ID | VARCHAR2 | 128 |  |  | Y |  |
| MEMORY_TYPE | VARCHAR2 | 128 |  |  | N |  |
| CONTENT | CLOB | 4000 |  |  | Y |  |
| TIMESTAMP | VARCHAR2 | 64 |  |  | Y |  |
| METADATA | JSON | 8200 |  |  | Y |  |
| EXPIRES_AT | TIMESTAMP(6) WITH TIME ZONE | 13 |  | 6 | Y |  |
| CREATED_AT | TIMESTAMP(6) WITH TIME ZONE | 13 |  | 6 | N | SYSTIMESTAMP  |

### MESSAGE

| column | type | length | precision | scale | nullable | default |
|---|---|---|---|---|---|---|
| RECORD_ID | VARCHAR2 | 128 |  |  | N |  |
| ORDER_SEQ | NUMBER | 22 |  |  | N | "AIM_APP"."ISEQ$$_73789".nextval |
| THREAD_ID | VARCHAR2 | 128 |  |  | Y |  |
| USER_ID | VARCHAR2 | 128 |  |  | Y |  |
| AGENT_ID | VARCHAR2 | 128 |  |  | Y |  |
| SPACE_ID | VARCHAR2 | 128 |  |  | Y |  |
| MESSAGE_ROLE | VARCHAR2 | 30 |  |  | N |  |
| CONTENT | CLOB | 4000 |  |  | Y |  |
| TIMESTAMP | VARCHAR2 | 64 |  |  | Y |  |
| METADATA | JSON | 8200 |  |  | Y |  |
| EXPIRES_AT | TIMESTAMP(6) WITH TIME ZONE | 13 |  | 6 | Y |  |
| CREATED_AT | TIMESTAMP(6) WITH TIME ZONE | 13 |  | 6 | N | SYSTIMESTAMP  |

### ORACLEAGENTMEMORY_SCHEMA_META

| column | type | length | precision | scale | nullable | default |
|---|---|---|---|---|---|---|
| METADATA_KEY | VARCHAR2 | 64 |  |  | N |  |
| METADATA_VALUE | VARCHAR2 | 4000 |  |  | N |  |
| UPDATED_AT | TIMESTAMP(6) WITH TIME ZONE | 13 |  | 6 | N | SYSTIMESTAMP  |

### RECORD_CHUNKS

| column | type | length | precision | scale | nullable | default |
|---|---|---|---|---|---|---|
| CHUNK_ID | NUMBER | 22 |  |  | N | "AIM_APP"."ISEQ$$_73803".nextval |
| SOURCE_ID | VARCHAR2 | 128 |  |  | N |  |
| SOURCE_RECORD_TYPE | VARCHAR2 | 30 |  |  | N |  |
| SOURCE_EMB_COLUMN | VARCHAR2 | 30 |  |  | N |  |
| CHUNK_SEQ | NUMBER | 22 |  |  | N | 1  |
| CHUNK_TEXT | CLOB | 4000 |  |  | Y |  |
| THREAD_ID | VARCHAR2 | 128 |  |  | Y |  |
| USER_ID | VARCHAR2 | 128 |  |  | Y |  |
| AGENT_ID | VARCHAR2 | 128 |  |  | Y |  |
| SPACE_ID | VARCHAR2 | 128 |  |  | Y |  |
| EMBEDDING | VECTOR | 8200 |  |  | Y |  |

### THREAD

| column | type | length | precision | scale | nullable | default |
|---|---|---|---|---|---|---|
| RECORD_ID | VARCHAR2 | 128 |  |  | N |  |
| USER_ID | VARCHAR2 | 128 |  |  | Y |  |
| AGENT_ID | VARCHAR2 | 128 |  |  | Y |  |
| SPACE_ID | VARCHAR2 | 128 |  |  | Y |  |
| METADATA | JSON | 8200 |  |  | Y |  |
| RUNTIME_CONFIG | JSON | 8200 |  |  | Y |  |
| RUNTIME_STATE | JSON | 8200 |  |  | Y |  |
| CREATED_AT | TIMESTAMP(6) WITH TIME ZONE | 13 |  | 6 | N | SYSTIMESTAMP  |

## Constraints

Type: P primary, U unique, R foreign key, C check (NOT NULL checks omitted).

| table | constraint | type | columns | references | on delete | condition |
|---|---|---|---|---|---|---|
| ACTOR_PROFILE | SYS_C008813 | C | ACTOR_TYPE |  |  | actor_type IN ('user', 'agent') |
| ACTOR_PROFILE | SYS_C008814 | P | ACTOR_ID |  |  |  |
| BIN$W71+Ilw2Bm/gYwIAEqzkZw==$0 | BIN$W71+Ilw0Bm/gYwIAEqzkZw==$0 | P | METADATA_KEY |  |  |  |
| BIN$W71+IlwwBm/gYwIAEqzkZw==$0 | BIN$W71+IlwpBm/gYwIAEqzkZw==$0 | C | ACTOR_TYPE |  |  | actor_type IN ('user', 'agent') |
| BIN$W71+IlwwBm/gYwIAEqzkZw==$0 | BIN$W71+IlwqBm/gYwIAEqzkZw==$0 | P | ACTOR_ID |  |  |  |
| BIN$W71is6z/BDTgYwIAEqxLJw==$0 | BIN$W71is6z4BDTgYwIAEqxLJw==$0 | C | ACTOR_TYPE |  |  | actor_type IN ('user', 'agent') |
| BIN$W71is6z/BDTgYwIAEqxLJw==$0 | BIN$W71is6z5BDTgYwIAEqxLJw==$0 | P | ACTOR_ID |  |  |  |
| MEMORY | SYS_C008828 | P | RECORD_ID |  |  |  |
| MEMORY | MEMORY_THREAD_FK | R | THREAD_ID | THREAD | CASCADE |  |
| MESSAGE | SYS_C008822 | P | RECORD_ID |  |  |  |
| MESSAGE | MESSAGE_THREAD_FK | R | THREAD_ID | THREAD | CASCADE |  |
| ORACLEAGENTMEMORY_SCHEMA_META | SYS_C008807 | P | METADATA_KEY |  |  |  |
| RECORD_CHUNKS | SYS_C008835 | P | CHUNK_ID |  |  |  |
| THREAD | SYS_C008817 | P | RECORD_ID |  |  |  |

## Indexes

| table | index | type | subtype | domain type | unique | columns |
|---|---|---|---|---|---|---|
| ACTOR_PROFILE | SYS_C008814 | NORMAL |  |  | UNIQUE | ACTOR_ID |
| MEMORY | SYS_C008828 | NORMAL |  |  | UNIQUE | RECORD_ID |
| MESSAGE | SYS_C008822 | NORMAL |  |  | UNIQUE | RECORD_ID |
| ORACLEAGENTMEMORY_SCHEMA_META | SYS_C008807 | NORMAL |  |  | UNIQUE | METADATA_KEY |
| RECORD_CHUNKS | RECORD_CHUNKS_EMBEDDING_VEC_I | VECTOR | INMEMORY_NEIGHBOR_GRAPH_HNSW |  | NONUNIQUE | EMBEDDING |
| RECORD_CHUNKS | SYS_C008835 | NORMAL |  |  | UNIQUE | CHUNK_ID |
| THREAD | SYS_C008817 | NORMAL |  |  | UNIQUE | RECORD_ID |

## Views

| view | text length |
|---|---|
| AIM_V_MEMORIES | 1068 |
| AIM_V_MESSAGES | 507 |
| AIM_V_STORE_INFO | 472 |
| AIM_V_THREADS | 965 |

## Sequences

| sequence | increment | last |
|---|---|---|
| ISEQ$$_73237 | 1 | 1 |
| ISEQ$$_73543 | 1 | 1 |
| ISEQ$$_73774 | 1 | 1 |
| ISEQ$$_73789 | 1 | 41 |
| ISEQ$$_73796 | 1 | 41 |
| ISEQ$$_73803 | 1 | 61 |

## Triggers

| trigger | table | event | status |
|---|---|---|---|

## Scheduler jobs

| job | type | repeat | enabled | state |
|---|---|---|---|---|
| PURGE_EXPIRED_RECORDS_J | PLSQL_BLOCK | FREQ=DAILY;INTERVAL=1 | TRUE | SCHEDULED |

## Other objects

| type | name |
|---|---|
