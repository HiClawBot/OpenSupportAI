# OpenSupportAI RAG 设计

## 目标

OpenSupportAI 的 RAG 系统服务于客服问答，不追求“百科问答式自由回答”，而追求：

```text
可控
可解释
可引用来源
可拒答
可转人工
多租户隔离
```

---

## 当前 Beta 范围

知识文档契约支持：

```text
markdown
text
url
pdf
```

当前已完整接入索引链路：

```text
markdown
text
```

存储：

```text
PostgreSQL
```

`knowledge_chunks.embedding` 保留 pgvector 字段，但当前在线检索不调用 embedding provider，也不执行向量检索。生产路径使用 PostgreSQL 全文检索、中文 n-gram 和 trigram；向量能力留给后续 hybrid retrieval。

---

## 文档生命周期

```text
pending
→ indexing
→ indexed
→ failed
```

---

## Ingestion 流程

```text
1. Admin 上传或创建知识文档。
2. knowledge_documents 写入 status=pending。
3. worker 获取任务。
4. 解析原始内容。
5. 清洗文本。
6. 按字符边界 chunk。
7. 写入 knowledge_chunks。
8. 数据库 trigger 生成 lexical search text。
9. document status=indexed。
```

---

## 文档解析

### Markdown

保留：

```text
标题层级
段落
列表
代码块
链接文本
```

### Text

按段落和长度切分。

### URL

v0.1 可以使用简单 HTML text extraction：

```text
title
main text
headings
links
```

### PDF

v0.1 只做文本型 PDF。扫描件 OCR 不进入首版。

---

## 清洗策略

```text
去除重复空行
去除导航、页脚、版权重复段
保留标题路径
保留 source_uri
保留 locale 和 tags
```

---

## Chunk 策略

当前参数：

```text
worker chunk_size: 900 characters
同步 API chunk_size: 1200 characters
retrieval candidate_limit: 24-48
retrieval result_limit: 1-20
orchestrator top_k: 6
```

每个 chunk 元数据：

```json
{
  "document_id": "doc_123",
  "title": "取消订阅说明",
  "source_uri": "https://docs.example.com/billing",
  "heading_path": ["账单", "取消订阅"],
  "locale": "zh-CN",
  "tags": ["billing", "subscription"]
}
```

---

## Embedding 预留

LLM client package 已提供 OpenAI-compatible embedding contract：

```text
POST {base_url}/embeddings
```

当前 ingestion 和 retrieval 未调用该接口。后续 hybrid retrieval 可支持：

```text
本地 embedding
BGE
Jina
Voyage
Cohere
```

---

## 当前 Retrieval

Prisma 模式：

```text
query normalize + term extraction
→ project_id + indexed document filter
→ PostgreSQL FTS OR trigram candidate search
→ bounded candidate set
→ shared deterministic score and threshold
→ stable top_k chunks + source refs
```

数据库使用两类 GIN 索引：

```sql
CREATE INDEX knowledge_chunks_search_text_fts_idx
  ON knowledge_chunks USING GIN (to_tsvector('simple', search_text));

CREATE INDEX knowledge_chunks_content_trgm_idx
  ON knowledge_chunks USING GIN (lower(content) gin_trgm_ops);
```

`search_text` 由数据库 trigger 维护。中文连续文本会扩展为 2-gram 和 3-gram，使没有空格的问句也可进入候选集；trigram 用于英文模糊匹配。最终相关性由 `@opensupportai/rag` 的共享规则重新计算，以保证 PostgreSQL 与 memory mode 行为一致。

Memory mode 只用于本地 demo，数据量有限，因此允许扫描当前项目的内存 chunk，但仍使用同一套 term、score、threshold 和稳定排序语义。

后续增强方向：

```text
vector + lexical hybrid search
rerank
query rewriting
multi-query retrieval
freshness ranking
document versioning
```

---

## 相关性与置信度

当前确定性规则：

```text
无 chunk → confidence = 0
lexical score < 0.34 → no-hit
trigram fallback score < 0.60 → 不进入候选集
有明确文档命中 → medium/high confidence
敏感意图 → force handoff 或谨慎回答
```

候选集最多 48 条，最终 repository 最多返回 20 条，正常回答管线取前 6 条。相同分数按 chunk id 稳定排序，避免测试与引用顺序漂移。任何查询都必须同时满足 `project_id` 和 `document.status = indexed`。

---

## Prompt 构造

### System Prompt

```text
你是一个客服助手。你必须遵守以下规则：
1. 只能根据提供的知识库内容回答。
2. 如果知识库中没有答案，明确说明暂时无法确认，并建议转人工。
3. 不要编造政策、价格、退款承诺、法律或医疗建议。
4. 涉及账号、账单、退款、身份、隐私数据时，必要时转人工。
5. 回答要简洁、友好、可操作。
6. 如果引用了知识库内容，返回 source_refs。
```

### Context 格式

```text
<knowledge>
[doc: doc_123 chunk: chunk_456 title: 取消订阅说明]
用户可以进入账单设置页面取消订阅。取消后当前周期仍可使用。
</knowledge>
```

---

## Source References

AI message 应保存 source refs：

```json
[
  {
    "document_id": "doc_123",
    "chunk_id": "chunk_456",
    "title": "取消订阅说明",
    "source_uri": "https://docs.example.com/billing",
    "score": 0.87
  }
]
```

Widget v0.1 可以简单显示“参考来源”。

---

## 拒答策略

以下情况不应生成自由回答：

```text
没有检索结果
检索分数过低
问题涉及具体账户账单但没有业务数据
用户请求退款/投诉/隐私删除
用户明显要求人工
问题超出产品知识范围
```

默认回复：

```text
这个问题我暂时无法根据当前知识库确认。为了避免给你错误信息，我可以帮你转接人工客服。
```

---

## 测试集

v0.1 应内置 demo FAQ：

```text
如何取消订阅
如何修改密码
如何导出数据
如何联系客服
退款政策
如何升级套餐
```

测试问题：

```text
我怎么取消订阅？
取消之后还能用到什么时候？
我忘记密码怎么办？
你能帮我退款吗？
我要投诉
这个产品支持火星部署吗？
```

期望：

```text
有文档命中 → 回答并引用
退款/投诉 → 转人工
无关问题 → 拒答或转人工
```

---

## 未来增强

```text
RAGFlow adapter
Qdrant adapter
OpenSearch hybrid search
reranker
文档版本化
自动过期知识
知识冲突检测
回答 grounding judge
基于 CSAT 的知识改进建议
```
