# PRD — Indexador Descentralizado de Documentação para Agentes de IA

## 1. Visão geral

Construir uma plataforma descentralizada de indexação de documentação técnica, na qual cada iniciativa/projeto mantém sua própria documentação em um repositório Git e participa ativamente do workflow de desenvolvimento.

A plataforma não será responsável por armazenar a documentação original.

A **fonte de verdade** será sempre a branch `main` do repositório de documentação de cada iniciativa.

A plataforma será responsável por:

* processar e indexar os arquivos de documentação a partir de pipelines configuradas por projeto;
* gerar embeddings dos chunks;
* armazenar os embeddings e metadados em PostgreSQL + pgVector;
* permitir busca semântica por projeto e palavras-chave;
* disponibilizar um servidor MCP para agentes de IA;
* permitir que agentes descubram documentação relevante antes de carregar seu conteúdo completo.

O sistema será composto inicialmente por dois componentes principais:

* **Indexer CLI** — escrita em Rust;
* **MCP Server** — escrita em TypeScript.

---

# 2. Problema

Uma empresa possui diversas iniciativas desenvolvidas por terceiros ou por diferentes equipes.

Cada iniciativa possui documentação própria, mas essa documentação frequentemente sofre de alguns problemas:

* fica desatualizada em relação à implementação;
* é armazenada em locais diferentes;
* não participa do workflow de desenvolvimento;
* não existe uma fonte clara de verdade;
* agentes de IA não conseguem descobrir facilmente a documentação relevante;
* colocar toda a documentação em um único banco ou contexto é caro e pouco escalável;
* sistemas de busca tradicionais dependem de conhecimento prévio sobre onde determinada informação está.

O problema central é:

> Como transformar documentação distribuída entre diversos projetos em uma fonte de contexto facilmente descoberta e consumível por agentes de IA, sem criar uma segunda fonte de verdade?

---

# 3. Hipótese

Se a documentação for tratada como código e cada iniciativa possuir um repositório próprio de documentação, então podemos:

1. manter a documentação próxima do projeto;
2. utilizar Pull Requests como mecanismo de revisão;
3. considerar apenas a branch `main` como documentação oficial;
4. gerar automaticamente uma projeção semântica dessa documentação;
5. permitir que agentes de IA encontrem contexto relevante sem precisar conhecer previamente a estrutura dos repositórios.

O índice passa a ser uma **view materializada semântica da documentação**, e não um repositório alternativo de conhecimento.

---

# 4. Princípios do produto

## 4.1 Git é a fonte de verdade

A plataforma nunca deve competir com o repositório de documentação.

Se houver divergência entre:

* Git;
* índice vetorial;

o Git sempre vence.

O índice deve ser reconstruível.

---

## 4.2 Main é a versão oficial

Somente conteúdo presente na branch `main` deve ser indexado como documentação oficial.

Branches de desenvolvimento e Pull Requests não fazem parte do índice oficial.

---

## 4.3 Documentação como produto

Cada iniciativa deve possuir um repositório de documentação que participe do processo de entrega.

Exemplo:

```text
initiative-a/
├── README.md
├── architecture/
│   ├── overview.md
│   └── integrations.md
├── api/
│   ├── authentication.md
│   └── payments.md
└── operations/
    └── deployment.md
```

Uma alteração relevante na documentação deve ocorrer através de um Pull Request.

Após o merge:

```text
Pull Request
     ↓
review
     ↓
merge → main
     ↓
indexer
     ↓
pgVector
     ↓
MCP
     ↓
AI Agent
```

---

## 4.4 O índice é descartável

O banco vetorial não precisa conter a documentação completa.

Ele deve conter apenas o suficiente para:

* descobrir documentos relevantes;
* realizar busca semântica;
* identificar o documento original;
* reconstruir o contexto posteriormente.

Se o banco for perdido, o sistema deve poder ser reconstruído executando o indexador novamente contra os repositórios.

---

## 4.5 Progressive Disclosure

O MCP não deve retornar automaticamente documentos inteiros em toda busca.

A interação ideal é:

```text
Agent
  ↓
"Quais documentos do projeto X falam sobre autenticação?"
  ↓
Semantic Search
  ↓
Lista de documentos/chunks relevantes
  ↓
Resumo para validação
  ↓
Agent escolhe documentos
  ↓
Fetch do documento original
  ↓
Contexto completo
```

Isso reduz:

* tokens;
* ruído;
* custo;
* contexto irrelevante.

---

# 5. Objetivos

## 5.1 Objetivos do MVP

O MVP deverá permitir:

* cadastrar projetos de documentação;
* indexar um repositório Git;
* processar arquivos Markdown;
* quebrar documentos em chunks;
* gerar embeddings;
* armazenar embeddings em PostgreSQL + pgVector;
* reindexar um arquivo inteiro quando ele mudar;
* remover do índice arquivos que foram deletados;
* realizar busca semântica;
* filtrar busca por projeto;
* localizar o documento original através do `path`;
* disponibilizar busca através de MCP;
* retornar resultados resumidos antes do conteúdo completo;
* buscar o conteúdo original diretamente da fonte de verdade.

---

# 6. Fora do escopo do MVP

Não fazem parte da primeira versão:

* armazenar o conteúdo integral da documentação no banco vetorial;
* versionamento próprio de documentação;
* editor web;
* interface web para edição de documentação;
* criação automática de Pull Requests;
* sincronização de branches que não sejam `main`;
* diff semântico entre versões;
* indexação incremental de pequenos trechos;
* crawler genérico da internet;
* suporte inicial a todos os formatos de documentos;
* ranking baseado em feedback humano;
* fine-tuning de modelos.

---

# 7. Arquitetura

A arquitetura conceitual será:

```text
                    SOURCE OF TRUTH
                         Git
                          │
                     branch main
                          │
                          ▼
                  ┌───────────────┐
                  │  Indexer CLI  │
                  │     Rust      │
                  └───────┬───────┘
                          │
                    parse/chunk
                          │
                          ▼
                    Embedding API
                      OpenRouter
                          │
                          ▼
                  ┌───────────────┐
                  │ PostgreSQL    │
                  │   + pgVector  │
                  └───────┬───────┘
                          │
                          ▼
                  ┌───────────────┐
                  │   MCP Server  │
                  │   TypeScript  │
                  └───────┬───────┘
                          │
                          ▼
                    AI Agents
```

O Git permanece fora da plataforma de indexação.

O PostgreSQL funciona como uma projeção pesquisável.

---

# 8. Componentes

## 8.1 Documentation Repository

Cada iniciativa possui um repositório dedicado à documentação.

Por padrão, recomenda-se utilizar uma ferramenta de documentação estruturada, como o Docusaurus, para organizar e publicar o conteúdo. No entanto, a plataforma não deve depender de um framework específico.

O requisito fundamental é que a documentação seja composta por arquivos Markdown (`.md`), versionados em Git e mantidos na branch `main`.

Exemplo:

```text
company/
├── initiative-a-docs
├── initiative-b-docs
├── initiative-c-docs
└── initiative-d-docs
```

Um repositório pode conter a estrutura padrão gerada por uma ferramenta como o Docusaurus:

```text
initiative-a-docs/
├── docs/
│   ├── introduction.md
│   ├── architecture.md
│   └── operations.md
├── blog/
├── static/
├── docusaurus.config.js
└── package.json
```

O indexador deverá receber como entrada o caminho da pasta raiz onde estão localizadas as documentações. Ele deverá priorizar os arquivos `.md` dentro dessa pasta, como `docs/`, ignorando arquivos de configuração, código-fonte, artefatos gerados e demais formatos que não façam parte da documentação oficial. Ao persistir os documentos indexados, deverá armazenar o caminho absoluto ou completo de cada arquivo, incluindo o caminho da pasta raiz, e nunca apenas o caminho relativo dentro do diretório de documentação.

A estrutura interna dos arquivos deve ser previsível e a documentação deve ser legível tanto por humanos quanto por agentes de IA. Cada documento deve utilizar headings, parágrafos, listas e blocos de código de forma semântica, permitindo que o indexador realize o chunking preservando o contexto das seções.

---

# 9. Indexer CLI

O Indexer será uma aplicação CLI escrita em Rust.

Responsabilidades:

* receber o path do arquivo que deverá ser indexado;
* ler o conteúdo do arquivo;
* realizar o chunking;
* gerar os embeddings;
* persistir os chunks;
* remover os chunks anteriormente associados ao arquivo;
* atualizar os metadados de indexação.

A CLI não deve manter estado local significativo.

A operação deve ser aproximadamente:

```text
Repository
     ↓
scan
     ↓
parse
     ↓
chunk
     ↓
embed
     ↓
persist
```

---

# 10. Estratégia de indexação

## 10.1 Indexação completa por arquivo

O MVP não implementará diff semântico.

Quando um arquivo for alterado:

```text
document.md
     ↓
delete existing indexed chunks
     ↓
read entire document
     ↓
chunk entire document
     ↓
generate embeddings
     ↓
insert new chunks
```

Isso simplifica significativamente o sistema.

Não precisamos inicialmente resolver:

* diff entre versões;
* identificação de chunks modificados;
* estabilidade de chunk IDs;
* merge de alterações parciais.

---

# 11. Detecção de mudanças

O indexador deverá conseguir operar em dois modos.

### Full indexing

Usado para:

* primeiro cadastro;
* rebuild;
* recuperação de banco perdido;
* migração.

Exemplo conceitual:

```bash
docs-indexer index --project payments
```

### Changed files

Usado pelo CI após um merge na `main`.

Exemplo:

```bash
docs-indexer index \
  --project payments \
  --files \
  docs/authentication.md \
  docs/api.md
```

O indexador também deve receber uma lista de arquivos deletados.

Exemplo:

```bash
docs-indexer delete \
  --project payments \
  --files docs/old-api.md
```

Uma alternativa futura é o próprio indexador receber o hash de um commit do repositório e trabalhar diretamente sobre essa versão específica. No MVP, o fluxo permanecerá simples e baseado na branch `main`.

---

# 12. Chunking

O documento será dividido em chunks antes da geração do embedding.

A estratégia inicial deve privilegiar estrutura semântica do Markdown.

Prioridade:

1. headings;
2. subsections;
3. parágrafos;
4. listas;
5. blocos de código.

Evitar quebrar indiscriminadamente no meio de uma seção.

Cada chunk deverá manter informação estrutural suficiente para reconstruir seu contexto.

Exemplo:

```text
Document:
architecture/integrations.md

Heading:
## Authentication

Chunk:
"Todas as chamadas para a API precisam..."

Metadata:
project = payments
path = architecture/integrations.md
heading = Authentication
```

---

# 13. Embeddings

O sistema utilizará um provedor externo de embeddings.

No MVP:

**OpenRouter** será utilizado como camada de acesso ao modelo.

Entretanto, o código do indexador deverá abstrair o provider através de uma interface.

Conceitualmente:

```rust
trait EmbeddingProvider {
    fn embed(&self, texts: Vec<String>) -> Result<Vec<Vector>>;
}
```

Isso permite posteriormente trocar:

* modelo;
* provider;
* estratégia de embedding;

sem alterar o restante do indexador.

A escolha específica do modelo de embedding deve ser configurável.

---

# 14. Banco de dados

PostgreSQL + pgVector será utilizado como índice semântico.

O banco não será utilizado como storage primário da documentação.

## 14.1 Modelo conceitual

### projects

Representa uma iniciativa.

```text
projects
--------
id
name
repository_url
default_branch
provider
created_at
updated_at
```

Exemplo:

```text
id: 42
name: payments
repository_url: ...
default_branch: main
```

---

### documents

Representa um arquivo da documentação.

## documents

project_id
path
chunk_content
embedding
metadata

A rastreabilidade será feita pelo `path`. O banco precisa armazenar somente o conteúdo do chunk, seu vetor e os metadados mínimos necessários para associá-lo ao projeto e ao arquivo de origem.

O `commit_sha` permite rastreabilidade.

---

### chunks

Representa uma unidade semântica pesquisável.

```text
chunks
------
id
document_id
chunk_index
text
embedding
heading
metadata
created_at
```

O campo `embedding` será do tipo `vector`.

---

# 15. Informação mínima armazenada

O requisito fundamental é:

> O banco precisa saber de qual projeto veio o chunk, qual é seu conteúdo semântico, qual é seu vetor e onde está o documento original.

Portanto, cada chunk deverá ser capaz de responder:

Qual projeto?
Qual arquivo?
Qual texto?
Qual embedding?
Qual commit da branch `main` originou esta versão?

O conteúdo completo do arquivo não precisa ser persistido como fonte de verdade.

---

# 16. Identidade do documento

Um documento deverá ser identificado logicamente por:

```text
project_id + path
```

Isso evita depender exclusivamente de IDs internos do banco.

Exemplo:

```text
payments + docs/authentication.md
```

representa um documento específico dentro do projeto.

---

# 17. Consistência

A indexação deve ser **idempotente**.

Executar:

```bash
docs-indexer index project-a
```

duas vezes com o mesmo conteúdo deve resultar no mesmo estado lógico.

A estratégia recomendada é:

```text
project + path
        ↓
remove old chunks
        ↓
insert new chunks
```

O processo pode utilizar uma transação para evitar que o documento fique parcialmente indexado.

---

# 18. Tratamento de arquivos deletados

Se um arquivo for removido da `main`, seus chunks também devem ser removidos do índice.

Exemplo:

```text
Git:
docs/old-api.md → deleted

Indexer:
DELETE FROM documents
WHERE project = X
AND path = 'docs/old-api.md'
```

Os chunks associados devem ser removidos em cascata ou através de uma operação transacional equivalente.

---

# 19. MCP Server

O MCP Server será escrito em TypeScript.

Seu objetivo é fornecer aos agentes de IA uma interface padronizada para descoberta e recuperação de documentação.

O MCP não deve ser um simples wrapper de SQL.

Ele deve expor uma abstração semântica de documentação.

---

# 20. Modelo de interação do MCP

A interação principal terá duas fases.

## Fase 1 — Discovery

O agente pergunta:

> "Quais documentos do projeto Payments falam sobre autenticação OAuth?"

O MCP realiza:

```text
query
 ↓
embedding
 ↓
vector search
 ↓
project filter
 ↓
ranking
 ↓
document grouping
```

E retorna algo como:

```text
1. Authentication Architecture
   docs/security/authentication.md

   Resumo:
   Explica como o projeto utiliza OAuth2,
   tokens e refresh tokens.

2. API Authentication
   docs/api/authentication.md

   Resumo:
   Descreve como clientes devem enviar
   credenciais para a API.
```

O agente ainda não recebe necessariamente o documento completo.

---

# 21. Fase 2 — Retrieval

Após identificar o documento relevante, o agente pode solicitar:

```text
get_document(
    project="payments",
    path="docs/security/authentication.md"
)
```

O MCP busca o arquivo diretamente na fonte de verdade.

Fluxo:

MCP
↓
Git provider
↓
repository
↓
path
↓
document content
↓
Agent

Assim, o contexto utilizado pelo agente vem diretamente da documentação oficial.

---

# 22. MCP Tools

O MVP deverá expor pelo menos duas operações conceituais.

## `search_documentation`

Entrada:

```text
project
query
limit
```

Exemplo:

```json
{
  "project": "payments",
  "query": "como funciona autenticação OAuth",
  "limit": 10
}
```

Retorno:

```text
document title
path
relevance score
chunk summary
section
```

---

## `get_document`

Entrada:

```text
project
path
```

Exemplo:

```json
{
  "project": "payments",
  "path": "docs/security/authentication.md"
}
```

Retorno:

```text
document metadata
document content
source reference
```

---

# 23. Possíveis ferramentas futuras do MCP

Posteriormente:

### `list_projects`

Lista os projetos disponíveis.

### `list_documents`

Lista os documentos de um projeto.

### `search_documentation`

Busca semântica.

### `get_document`

Obtém documentação completa.

### `get_section`

Obtém apenas uma seção.

### `get_related_documents`

Encontra documentação relacionada ao documento atual.

### `get_document_metadata`

Obtém informações sobre atualização, commit e origem.

---

# 24. Resumos dos chunks

Existe uma decisão importante aqui.

O sistema precisa fornecer ao agente uma representação pequena do resultado da busca.

Existem duas possibilidades:

### Opção B — retornar os resultados diretamente

Durante a busca:

```text
vector search
 ↓
top chunks
 ↓
retorno dos resultados diretamente
```

O sistema não deverá gerar nem armazenar resumos adicionais dos chunks.

O MCP deverá retornar diretamente os resultados mais relevantes da busca, contendo:

* título do documento;
* path;
* heading ou seção;
* trecho do chunk;
* score de relevância;
* metadados disponíveis.

O agente poderá validar os resultados e, em seguida, solicitar o documento completo diretamente da fonte de verdade.

Essa abordagem evita:

* custo adicional de chamadas a LLM;
* aumento do tempo de indexação;
* armazenamento redundante;
* divergência entre o resumo e o conteúdo original;
* complexidade adicional no pipeline de indexação.

Durante a busca:

```text
vector search
 ↓
top chunks
 ↓
similarity score
 ↓
project name
 ↓
document path
 ↓
chunk text
```

Essa etapa não faz parte do plano.

O resultado pode inicialmente retornar:

* título;
* heading;
* trecho representativo;
* score;
* path.

Posteriormente podemos adicionar resumo gerado sob demanda ou pré-calculado.

Isso reduz bastante a complexidade inicial.

---

# 25. Ranking

O ranking inicial será baseado em similaridade vetorial.

A busca deverá considerar:

```text
embedding similarity
+
project filter
+
metadata
```

Posteriormente poderá ser introduzido hybrid search:

```text
semantic similarity
+
full-text search
+
metadata
+
reranking
```

Isso será especialmente útil para:

* nomes de APIs;
* nomes de classes;
* códigos de erro;
* identificadores;
* siglas;
* nomes próprios de sistemas.

---

# 26. Projeto como unidade de isolamento

O projeto deve ser uma dimensão obrigatória do índice.

A busca ideal é:

```text
project = payments
query = authentication
```

em vez de simplesmente:

```text
query = authentication
```

Isso reduz ambiguidades entre iniciativas diferentes.

Uma busca global poderá existir posteriormente:

```text
project = *
query = authentication
```

---

# 27. Segurança

O índice poderá conter documentação interna.

Portanto, o sistema deve considerar autorização desde o início.

A regra fundamental deve ser:

> Um agente só pode pesquisar documentação que ele também teria permissão para acessar na fonte de verdade.

Isso implica que o MCP eventualmente deverá conhecer:

```text
agent identity
        ↓
project permissions
        ↓
repository permissions
```

O MVP pode começar com autenticação simples em nível de servidor, mas o modelo de autorização não deve ser desenhado de forma que impeça autorização por projeto posteriormente.

---

# 28. Fonte de verdade e autorização

Um ponto especialmente importante:

**não basta proteger o PostgreSQL.**

Mesmo que um usuário consiga descobrir o `path` através do índice, o MCP não deve retornar o documento se ele não tiver acesso ao repositório original.

A autorização deverá ser aplicada tanto em:

```text
search
```

quanto em:

```text
get_document
```

---

# 29. Integração com CI/CD

O workflow esperado é:

```text
Developer
    │
    ▼
Edit documentation
    │
    ▼
Pull Request
    │
    ▼
Review
    │
    ▼
Merge
    │
    ▼
main
    │
    ▼
CI
    │
    ▼
Indexer CLI
    │
    ▼
pgVector
```

O indexador deve ser fácil de executar em:

* GitHub Actions;
* GitLab CI;
* Jenkins;
* pipelines proprietários;
* containers.

---

# 30. Contrato do CLI

A CLI deve ser simples e composável.

Exemplo:

```bash
docs-indexer index \
  --project payments \
  --repository ./docs
```

Indexação de arquivos específicos:

```bash
docs-indexer index \
  --project payments \
  --files docs/api.md docs/auth.md
```

Remoção:

```bash
docs-indexer delete \
  --project payments \
  --files docs/old.md
```

Rebuild:

```bash
docs-indexer rebuild \
  --project payments
```

Verificação:

```bash
docs-indexer verify \
  --project payments
```

---

# 31. Configuração

A configuração deve ser externalizada.

Exemplo conceitual:

```yaml
project: payments

repository:
  url: ...
  branch: main

index:
  extensions:
    - md
    - mdx

embedding:
  provider: openrouter
  model: ...

database:
  url: ...
```

Secrets nunca devem ficar no arquivo de configuração versionado.

---

# 32. Observabilidade

O indexador deverá produzir logs estruturados.

Exemplo:

```text
project=payments
path=docs/auth.md
status=indexed
chunks=12
duration_ms=842
commit_sha=abc123
```

Métricas importantes:

* documentos processados;
* chunks criados;
* chunks removidos;
* embeddings gerados;
* tempo de indexação;
* erros de embedding;
* erros de Git;
* tamanho médio dos chunks;
* latência de busca MCP.

---

# 33. Resiliência

O sistema deve tolerar falhas externas.

Exemplos:

* OpenRouter indisponível;
* PostgreSQL indisponível;
* Git provider indisponível;
* timeout de API;
* rate limit.

Uma falha durante a indexação não deve deixar um documento em estado parcialmente atualizado.

Preferencialmente:

```text
begin transaction
    delete old chunks
    insert new chunks
commit
```

Se o embedding falhar:

```text
rollback
```

e a versão anterior do índice permanece disponível.

---

# 34. Versionamento

Cada documento indexado deve guardar o `commit_sha` correspondente à versão da `main`.

Exemplo:

```text
project:
payments

path:
docs/authentication.md

commit:
7f91c2a
```

Isso permite responder futuramente:

> "De qual versão da documentação veio este resultado?"

Também facilita debugging de inconsistências.

---

# 35. Estado do índice

O sistema deve assumir que o índice pode estar temporariamente atrasado.

Portanto:

```text
main
  │
  ├── documentação atual
  │
  └── índice
        └── versão anterior
```

é um estado possível.

O objetivo é obter **eventual consistency**.

A plataforma poderá expor posteriormente:

```text
indexed_commit
latest_commit
index_status
```

---

# 36. Reindexação completa

Deve existir uma operação de rebuild.

Exemplo:

```text
DELETE project index
        ↓
scan main
        ↓
index every document
```

Isso é fundamental porque o índice é uma projeção descartável.

O rebuild será usado para:

* troca de modelo de embedding;
* mudança de chunking;
* migração de schema;
* recuperação de desastre;
* correção de bugs do indexador.

---

# 37. Mudança de modelo de embedding

A dimensão do vetor depende do modelo.

Portanto, o banco deverá considerar a versão do modelo.

Exemplo:

```text
embedding_provider
embedding_model
embedding_dimension
```

Idealmente, a infraestrutura deve permitir reconstruir o índice quando o modelo mudar.

Uma estratégia futura seria suportar índices versionados:

```text
index_v1
index_v2
```

permitindo migração sem downtime.

---

# 38. Performance

O sistema deve ser otimizado principalmente para:

### Indexação

* processamento em lote;
* chamadas de embedding em batch;
* transações;
* paralelismo controlado.

### Busca

* índice pgVector apropriado;
* filtros por projeto;
* limites de resultados;
* pooling de conexões.

O objetivo não é fazer o PostgreSQL armazenar todo o conteúdo documental, mas funcionar como um **semantic retrieval layer**.

---

# 39. Requisitos funcionais

## RF01 — Cadastro de projeto

O sistema deve permitir registrar um projeto de documentação.

## RF02 — Indexação

O sistema deve indexar os documentos presentes na branch `main`.

## RF03 — Chunking

O sistema deve dividir documentos em chunks semânticos.

## RF04 — Embedding

O sistema deve gerar embeddings para cada chunk.

## RF05 — Persistência

O sistema deve armazenar embeddings e metadados no PostgreSQL + pgVector.

## RF06 — Reindexação

O sistema deve permitir reindexar completamente um documento.

## RF07 — Delete

O sistema deve remover documentos que não existem mais na fonte.

## RF08 — Busca

O sistema deve permitir busca semântica.

## RF09 — Filtro por projeto

A busca deve poder ser limitada a um projeto.

## RF10 — Discovery

O MCP deve retornar informações resumidas sobre documentos encontrados.

## RF11 — Retrieval

O MCP deve permitir obter o documento original.

## RF12 — Source of Truth

O conteúdo retornado pelo retrieval deve vir da fonte original.

## RF13 — Idempotência

Indexar o mesmo conteúdo repetidamente não deve gerar duplicação lógica.

## RF14 — Rastreamento

O sistema deve registrar o commit correspondente à versão indexada.

---

# 40. Requisitos não funcionais

## RNF01 — Rebuildability

Todo o índice deve poder ser reconstruído a partir dos repositórios.

## RNF02 — Stateless Indexer

A CLI não deve depender de estado persistente local.

## RNF03 — Segurança

Documentação protegida não pode ser exposta através do MCP.

## RNF04 — Observabilidade

Operações devem gerar logs estruturados.

## RNF05 — Portabilidade

O indexador deve funcionar em ambientes CI/CD.

## RNF06 — Provider abstraction

O embedding provider deve ser substituível.

## RNF07 — Eventual consistency

O sistema deve tolerar atraso entre `main` e o índice.

---

# 41. Critérios de sucesso do MVP

O MVP será considerado funcional quando for possível executar o seguinte cenário:

### Cenário

Existe o projeto:

```text
payments-docs
```

O repositório contém:

```text
docs/
├── architecture.md
├── authentication.md
├── payments.md
└── deployment.md
```

O indexador é executado.

Resultado:

```text
PostgreSQL
    ↓
4 documents
    ↓
N chunks
    ↓
N embeddings
```

Um agente pergunta:

```text
"Como funciona autenticação no projeto payments?"
```

O MCP retorna:

```text
authentication.md
Authentication

[trecho/resumo]

relevance: 0.91
```

O agente solicita:

```text
get_document(
  project="payments",
  path="docs/authentication.md"
)
```

O MCP consulta o repositório e retorna a versão atual da `main`.

Esse fluxo deve funcionar de ponta a ponta.

---

# 42. MVP técnico recomendado

Para evitar que o projeto fique grande demais inicialmente, a primeira versão pode ser deliberadamente pequena:

### Indexer

* Rust;
* Markdown;
* Git;
* chunking baseado em headings/tamanho;
* OpenRouter;
* PostgreSQL;
* pgVector.

### MCP

* TypeScript;
* MCP SDK;
* PostgreSQL;
* Git provider;
* duas tools:

  * `search_documentation`
  * `get_document`.

### Infraestrutura

* PostgreSQL + pgVector;
* Docker;
* CI;
* secrets via environment variables.

Nada além disso é necessário para validar a hipótese.

---

# 43. Roadmap

## Fase 1 — Proof of Concept

Objetivo:

> provar que agentes conseguem descobrir e consumir documentação distribuída.

Implementar:

* schema;
* Rust indexer;
* embedding;
* pgVector;
* MCP;
* search;
* get document.

---

## Fase 2 — Production MVP

Adicionar:

* autenticação;
* autorização por projeto;
* GitHub/GitLab integration;
* CI examples;
* observabilidade;
* retries;
* idempotência;
* delete handling;
* rebuild.

---

## Fase 3 — Retrieval avançado

Adicionar:

* hybrid search;
* reranking;
* related documents;
* section retrieval;
* filtros por metadata;
* busca global.

---

## Fase 4 — Platform

Adicionar:

* dashboard;
* gestão de projetos;
* status do índice;
* métricas;
* auditoria;
* múltiplos providers;
* múltiplos modelos de embedding;
* index versions.

---

# 44. Decisões arquiteturais importantes

## Decisão 1 — Não armazenar documentação completa no pgVector

**Motivo:** evitar criar uma segunda fonte de verdade.

O banco contém:

```text
metadata
+
chunk text
+
embedding
```

mas o documento oficial permanece no Git.

---

## Decisão 2 — Reindexar o arquivo inteiro

**Motivo:** simplicidade.

O custo computacional adicional é aceitável para o MVP e elimina uma quantidade significativa de complexidade.

---

## Decisão 3 — Rust para o indexador

**Motivo:**

* CLI robusta;
* excelente performance;
* distribuição simples;
* baixo consumo de memória;
* bom suporte para processamento concorrente;
* binário único.

---

## Decisão 4 — TypeScript para MCP

**Motivo:**

* ecossistema MCP;
* facilidade de integração com APIs;
* desenvolvimento rápido;
* bom suporte para servidores;
* separação clara entre ingestion e serving.

---

## Decisão 5 — Provider de embeddings abstrato

Mesmo utilizando OpenRouter inicialmente, o indexador não deve ficar arquiteturalmente acoplado ao provider.

---

# 45. Principal insight do produto

O produto não é, essencialmente, um "banco vetorial de documentação".

O produto é uma **camada de descoberta semântica sobre documentação distribuída**.

A arquitetura pode ser entendida como:

```text
             DOCUMENTATION
                   │
             Git / main
                   │
                   ▼
             ┌───────────┐
             │  Indexer  │
             └─────┬─────┘
                   │
             semantic index
                   │
                   ▼
             ┌───────────┐
             │ pgVector  │
             └─────┬─────┘
                   │
              discovery
                   │
                   ▼
             ┌───────────┐
             │    MCP    │
             └─────┬─────┘
                   │
              AI Agent
                   │
             selected docs
                   │
                   ▼
             Git / main
                   │
                   ▼
             Full Context
```

Essa separação é o que torna a arquitetura interessante.

O agente **não precisa confiar no índice como fonte da documentação**. Ele utiliza o índice para descobrir *onde olhar* e depois busca a verdade diretamente na origem.

---

# 46. Definição resumida do produto

> **Um índice semântico descentralizado para documentação versionada em Git, projetado para permitir que agentes de IA descubram e recuperem contexto confiável sem transformar o banco vetorial em uma segunda fonte de verdade.**

O fluxo fundamental é:

```text
WRITE
Documentação é escrita no repositório.

REVIEW
Alterações passam por Pull Request.

MERGE
main representa a documentação oficial.

INDEX
O CLI transforma a documentação em uma projeção semântica.

DISCOVER
O agente utiliza MCP para encontrar documentação relevante.

VALIDATE
O agente recebe títulos, paths e trechos/resumos.

RETRIEVE
O agente solicita os documentos selecionados.

TRUST
O conteúdo completo vem diretamente da branch main.
```

