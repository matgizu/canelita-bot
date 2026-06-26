SET search_path TO freskabox;
SELECT
  c."adSource"                                   AS ad_id,
  LEFT(MAX(c."adHeadline"), 30)                  AS anuncio,
  COUNT(DISTINCT c.id)                           AS leads,
  COUNT(DISTINCT c.id) FILTER (WHERE c."state" <> 'GREETING') AS enganch,
  COUNT(DISTINCT o."conversationId")             AS pedidos,
  ROUND(100.0 * COUNT(DISTINCT o."conversationId") / NULLIF(COUNT(DISTINCT c.id),0),1) AS conv_pct,
  COALESCE(SUM(o.total),0)                       AS ingreso
FROM "Conversation" c
LEFT JOIN "Order" o ON o."conversationId" = c.id
WHERE c."adSource" IS NOT NULL
GROUP BY c."adSource"
ORDER BY pedidos DESC, leads DESC;
