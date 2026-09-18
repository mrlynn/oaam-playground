# Schema snapshot

Generated 2026-09-18 07:37 UTC by `agent/scripts/dump_schema.py`.

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
| AIM_RUNS | 0 |
| AIM_RUN_EVENTS | 0 |
| AIM_TURNS | 0 |
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

### AIM_RUNS

| column | type | length | precision | scale | nullable | default |
|---|---|---|---|---|---|---|
| RUN_ID | VARCHAR2 | 128 |  |  | N |  |
| SOURCE | VARCHAR2 | 16 |  |  | N | 'instrumented'  |
| USER_ID | VARCHAR2 | 128 |  |  | Y |  |
| AGENT_ID | VARCHAR2 | 128 |  |  | Y |  |
| LLM_MODEL | VARCHAR2 | 256 |  |  | Y |  |
| EMBED_MODEL | VARCHAR2 | 256 |  |  | Y |  |
| PACKAGE_VERSION | VARCHAR2 | 32 |  |  | Y |  |
| FIRST_TURN_AT | TIMESTAMP(6) WITH TIME ZONE | 13 |  | 6 | Y |  |
| LAST_TURN_AT | TIMESTAMP(6) WITH TIME ZONE | 13 |  | 6 | Y |  |
| TURN_COUNT | NUMBER | 22 |  |  | N | 0  |
| NOTES | JSON | 8200 |  |  | Y |  |

### AIM_RUN_EVENTS

| column | type | length | precision | scale | nullable | default |
|---|---|---|---|---|---|---|
| EVENT_ID | NUMBER | 22 |  |  | N | "AIM_APP"."ISEQ$$_74476".nextval |
| RUN_ID | VARCHAR2 | 128 |  |  | Y |  |
| TURN | NUMBER | 22 |  |  | Y |  |
| SEQ | NUMBER | 22 |  |  | N |  |
| PARENT_SEQ | NUMBER | 22 |  |  | Y |  |
| DEPTH | NUMBER | 22 |  |  | N | 0  |
| STAGE | VARCHAR2 | 16 |  |  | N |  |
| NAME | VARCHAR2 | 256 |  |  | N |  |
| SOURCE | VARCHAR2 | 8 |  |  | N |  |
| STARTED_AT | TIMESTAMP(6) WITH TIME ZONE | 13 |  | 6 | N |  |
| DURATION_MS | NUMBER | 22 |  |  | Y |  |
| INPUT_SUMMARY | VARCHAR2 | 4000 |  |  | Y |  |
| OUTPUT_SUMMARY | VARCHAR2 | 4000 |  |  | Y |  |
| MEMORY_IDS | JSON | 8200 |  |  | Y |  |
| SCOPE | JSON | 8200 |  |  | Y |  |
| TOKENS | JSON | 8200 |  |  | Y |  |
| ATTRS | JSON | 8200 |  |  | Y |  |
| ERROR | VARCHAR2 | 4000 |  |  | Y |  |

### AIM_TURNS

| column | type | length | precision | scale | nullable | default |
|---|---|---|---|---|---|---|
| RUN_ID | VARCHAR2 | 128 |  |  | N |  |
| TURN | NUMBER | 22 |  |  | N |  |
| STARTED_AT | TIMESTAMP(6) WITH TIME ZONE | 13 |  | 6 | N |  |
| DURATION_MS | NUMBER | 22 |  |  | Y |  |
| USER_MESSAGE | CLOB | 4000 |  |  | Y |  |
| RETRIEVED | JSON | 8200 |  |  | Y |  |
| MESSAGE_IDS | JSON | 8200 |  |  | Y |  |
| MEMORY_DIFF | JSON | 8200 |  |  | Y |  |
| ATTRS | JSON | 8200 |  |  | Y |  |
| ASSEMBLED_PROMPT | CLOB | 4000 |  |  | Y |  |
| PROMPT_TOKENS | NUMBER | 22 |  |  | Y |  |
| FLAT_HISTORY_TOKENS | NUMBER | 22 |  |  | Y |  |
| TOKEN_METHOD | VARCHAR2 | 256 |  |  | Y |  |
| REPLY | CLOB | 4000 |  |  | Y |  |
| REPLY_SOURCE | VARCHAR2 | 16 |  |  | Y |  |
| USAGE | JSON | 8200 |  |  | Y |  |

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
| AIM_RUNS | AIM_RUNS_SOURCE_CK | C | SOURCE |  |  | source IN ('instrumented', 'replay', 'live') |
| AIM_RUNS | SYS_C008853 | P | RUN_ID |  |  |  |
| AIM_RUN_EVENTS | AIM_RUN_EVENTS_SOURCE_CK | C | SOURCE |  |  | source IN ('wrapper', 'log') |
| AIM_RUN_EVENTS | AIM_RUN_EVENTS_STAGE_CK | C | STAGE |  |  | stage IN                     ('ingestion', 'extraction', 'consolidation', 'retrieval', 'summarization', 'revision', 'other') |
| AIM_RUN_EVENTS | SYS_C008869 | P | EVENT_ID |  |  |  |
| AIM_RUN_EVENTS | AIM_RUN_EVENTS_RUN_FK | R | RUN_ID | AIM_RUNS | CASCADE |  |
| AIM_TURNS | AIM_TURNS_REPLY_SOURCE_CK | C | REPLY_SOURCE |  |  | reply_source IN ('scripted', 'model') |
| AIM_TURNS | AIM_TURNS_PK | P | RUN_ID, TURN |  |  |  |
| AIM_TURNS | AIM_TURNS_RUN_FK | R | RUN_ID | AIM_RUNS | CASCADE |  |
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
| AIM_RUNS | SYS_C008853 | NORMAL |  |  | UNIQUE | RUN_ID |
| AIM_RUN_EVENTS | AIM_RUN_EVENTS_TURN_I | NORMAL |  |  | NONUNIQUE | RUN_ID, TURN, SEQ |
| AIM_RUN_EVENTS | SYS_C008869 | NORMAL |  |  | UNIQUE | EVENT_ID |
| AIM_TURNS | AIM_TURNS_PK | NORMAL |  |  | UNIQUE | RUN_ID, TURN |
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
| AIM_V_MEMORY_RETRIEVALS | 596 |
| AIM_V_MESSAGES | 507 |
| AIM_V_RUNS | 152 |
| AIM_V_RUN_EVENTS | 207 |
| AIM_V_STORE_INFO | 472 |
| AIM_V_THREADS | 965 |
| AIM_V_TURNS | 229 |

## Sequences

| sequence | increment | last |
|---|---|---|
| ISEQ$$_73237 | 1 | 1 |
| ISEQ$$_73543 | 1 | 1 |
| ISEQ$$_73774 | 1 | 1 |
| ISEQ$$_73789 | 1 | 41 |
| ISEQ$$_73796 | 1 | 41 |
| ISEQ$$_73803 | 1 | 61 |
| ISEQ$$_74476 | 1 | 21 |

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
