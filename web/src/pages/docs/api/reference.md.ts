// Markdown twin of /docs/api/reference, generated from the OpenAPI document.
import type { APIRoute } from "astro";
import { SPEC, curl, operations, typeLabel } from "@/lib/openapi";
import { SITE } from "@/lib/site";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export const GET: APIRoute = () => {
  const ops = operations();
  const body = [
    "# API reference",
    "",
    `> ${SPEC.info.title} ${SPEC.info.version}: every endpoint, parameter and response. Machine-readable: ${SITE.url}/openapi.json`,
    "",
    ...ops.flatMap((op) => [
      `## ${op.method} ${op.path}`,
      "",
      `${op.summary}${op.id ? ` (\`${op.id}\`)` : ""}`,
      "",
      ...(op.description ? [op.description.trim(), ""] : []),
      ...(op.parameters.length
        ? ["| Parameter | In | Type | Description |", "| --- | --- | --- | --- |", ...op.parameters.map((p) => `| \`${p.name}\`${p.required ? " (required)" : ""} | ${p.in} | ${cell(typeLabel(p.schema))} | ${cell(p.description ?? "")} |`), ""]
        : []),
      "Responses: " + op.responses.map((r) => `\`${r.status}\` ${r.description}${r.schema ? ` (${r.schema})` : ""}`).join("; "),
      "",
      "```bash",
      curl(op, SITE.url),
      "```",
      "",
    ]),
    `Schemas: ${Object.keys(SPEC.components.schemas).join(", ")}. See ${SITE.url}/openapi.json.`,
    "",
    "---",
    `Source: ${SITE.url}/docs/api/reference`,
    "",
  ];
  return new Response(body.join("\n"), { headers: { "content-type": "text/markdown; charset=utf-8" } });
};
