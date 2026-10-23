/**
 * Content collections. `collections` are the curated sample pages under
 * /samples/<slug>: editorial copy and a saved search, one Markdown file each.
 * Their results come from web/src/data/collections/<slug>.json, refreshed by
 * scripts/snapshot-collections.mjs. scripts/lib/topics.mjs checks the same
 * files against the editorial rules (lengths, related pages, FAQ).
 * Categories and forms come from the server's vocabulary (src/data/vocab.json).
 */
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import vocab from "./data/vocab.json";

const CATEGORIES = vocab.categories.map((c) => c.id) as [string, ...string[]];
const FORMS = vocab.forms as [string, ...string[]];

const sampleCollections = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/collections" }),
  schema: z.object({
    title: z.string().min(10).max(60),
    description: z.string().min(110).max(160),
    hub: z.string(),
    search: z.object({
      q: z.string().min(2).max(60),
      categories: z.array(z.enum(CATEGORIES)).min(1).optional(),
      forms: z.array(z.enum(FORMS)).min(1).optional(),
      free: z.boolean().optional(),
      commercial: z.boolean().optional(),
      downloadable: z.boolean().optional(),
      providers: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    }),
    aliases: z.array(z.string()).optional(),
    related: z.array(z.string()).min(2).max(6),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).min(2).max(5),
    addedAt: z.coerce.date(),
    addedBy: z.enum(["human", "agent"]),
  }),
});

export const collections = { collections: sampleCollections };
