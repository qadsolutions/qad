/**
 * Golden set for the retrieval-quality eval (issue #85).
 *
 * A synthetic-but-realistic knowledge base for one fictional service business
 * (Northwind Home Services, an HVAC/home-services company) plus a set of questions
 * mapped to the chunk(s) that should be retrieved to answer them. SYNTHETIC ONLY —
 * safe to embed under any provider (no real client data; SECURITY.md §2).
 *
 * The eval harness ingests these chunks (real Ollama embeddings), runs each question
 * through the M4 retrieval path, and scores recall@k / hit-rate@k against
 * `expectedChunkIds`. Curate the mappings so the *answering* chunk is unambiguous;
 * the recorded baseline (docs/retrieval-eval-baseline.md) then reflects embedding +
 * chunking quality, and a drop after a model/chunking change is the signal.
 */

import type { GoldenQuestion } from "@/lib/rag/eval-metrics";

export interface GoldenDocument {
  id: string;
  filename: string;
}

export interface GoldenChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
}

export const GOLDEN_TENANT_ID = "ee000000-0000-0000-0000-0000000000e1";
export const GOLDEN_USER_ID = "ee000000-0000-0000-0000-0000000000e2";

const DOC_SCHEDULING = "ee000000-0000-0000-0000-0000000000d1";
const DOC_PRICING = "ee000000-0000-0000-0000-0000000000d2";
const DOC_WARRANTY = "ee000000-0000-0000-0000-0000000000d3";

export const GOLDEN_DOCUMENTS: GoldenDocument[] = [
  { id: DOC_SCHEDULING, filename: "service-and-scheduling.md" },
  { id: DOC_PRICING, filename: "pricing-and-payment.md" },
  { id: DOC_WARRANTY, filename: "warranty-and-policies.md" },
];

// Chunk ids — stable, referenced by the questions below.
export const CHUNK = {
  HOURS: "ee000000-0000-0000-0000-0000000000c1",
  EMERGENCY: "ee000000-0000-0000-0000-0000000000c2",
  AREAS: "ee000000-0000-0000-0000-0000000000c3",
  BOOKING: "ee000000-0000-0000-0000-0000000000c4",
  DIAGNOSTIC: "ee000000-0000-0000-0000-0000000000c5",
  HOURLY: "ee000000-0000-0000-0000-0000000000c6",
  PAYMENT: "ee000000-0000-0000-0000-0000000000c7",
  FINANCING: "ee000000-0000-0000-0000-0000000000c8",
  LABOR_WARRANTY: "ee000000-0000-0000-0000-0000000000c9",
  PARTS_WARRANTY: "ee000000-0000-0000-0000-0000000000ca",
  CANCELLATION: "ee000000-0000-0000-0000-0000000000cb",
  GUARANTEE: "ee000000-0000-0000-0000-0000000000cc",
} as const;

export const GOLDEN_CHUNKS: GoldenChunk[] = [
  {
    id: CHUNK.HOURS,
    documentId: DOC_SCHEDULING,
    chunkIndex: 0,
    text: "Our office is open Monday through Friday, 7:00 AM to 6:00 PM, and Saturday 8:00 AM to 2:00 PM. We are closed on Sundays and major holidays.",
  },
  {
    id: CHUNK.EMERGENCY,
    documentId: DOC_SCHEDULING,
    chunkIndex: 1,
    text: "Emergency service is available 24/7 for no-heat and no-cooling situations. After-hours emergency calls incur an additional $95 dispatch fee.",
  },
  {
    id: CHUNK.AREAS,
    documentId: DOC_SCHEDULING,
    chunkIndex: 2,
    text: "We serve the greater Portland metro area, including Beaverton, Hillsboro, Gresham, Lake Oswego, and Tigard. Service beyond a 30-mile radius of our Beaverton office may incur a travel surcharge.",
  },
  {
    id: CHUNK.BOOKING,
    documentId: DOC_SCHEDULING,
    chunkIndex: 3,
    text: "To schedule a service appointment, call our office or book online. We offer two-hour arrival windows and send a text message when your technician is en route.",
  },
  {
    id: CHUNK.DIAGNOSTIC,
    documentId: DOC_PRICING,
    chunkIndex: 0,
    text: "A standard diagnostic visit is $89, which covers a full system inspection and a written estimate. The diagnostic fee is waived if you proceed with the recommended repair.",
  },
  {
    id: CHUNK.HOURLY,
    documentId: DOC_PRICING,
    chunkIndex: 1,
    text: "Labor is billed at $125 per hour during regular business hours, with a one-hour minimum. After-hours and weekend labor is billed at $185 per hour.",
  },
  {
    id: CHUNK.PAYMENT,
    documentId: DOC_PRICING,
    chunkIndex: 2,
    text: "We accept all major credit cards, checks, and cash. Payment is due upon completion of the work. We do not accept payment by wire transfer.",
  },
  {
    id: CHUNK.FINANCING,
    documentId: DOC_PRICING,
    chunkIndex: 3,
    text: "Financing is available on installations over $2,000 through our partner lender, with approved credit and terms up to 60 months at competitive rates.",
  },
  {
    id: CHUNK.LABOR_WARRANTY,
    documentId: DOC_WARRANTY,
    chunkIndex: 0,
    text: "All repair labor is guaranteed for 90 days. If the same issue recurs within that window, we will return and fix it at no additional labor charge.",
  },
  {
    id: CHUNK.PARTS_WARRANTY,
    documentId: DOC_WARRANTY,
    chunkIndex: 1,
    text: "Manufacturer parts carry a warranty of one to ten years depending on the component. We register every new installation with the manufacturer on your behalf.",
  },
  {
    id: CHUNK.CANCELLATION,
    documentId: DOC_WARRANTY,
    chunkIndex: 2,
    text: "Appointments may be rescheduled or cancelled at no charge up to 24 hours in advance. Cancellations within 24 hours are subject to a $49 fee.",
  },
  {
    id: CHUNK.GUARANTEE,
    documentId: DOC_WARRANTY,
    chunkIndex: 3,
    text: "Your satisfaction is guaranteed. If you are not happy with a completed repair, contact us within 30 days and we will make it right or refund the labor cost.",
  },
];

/** Positive questions — each maps to the chunk(s) that should answer it. */
export const GOLDEN_QUESTIONS: GoldenQuestion[] = [
  { id: "q-hours", question: "What are your office hours?", expectedChunkIds: [CHUNK.HOURS] },
  { id: "q-weekend", question: "Are you open on Saturdays?", expectedChunkIds: [CHUNK.HOURS] },
  {
    id: "q-emergency",
    question: "Do you offer 24/7 emergency service if my heat goes out at night?",
    expectedChunkIds: [CHUNK.EMERGENCY],
  },
  {
    id: "q-areas",
    question: "Which cities and areas do you service?",
    expectedChunkIds: [CHUNK.AREAS],
  },
  {
    id: "q-booking",
    question: "How do I book a service appointment?",
    expectedChunkIds: [CHUNK.BOOKING],
  },
  {
    id: "q-diagnostic",
    question: "How much does a diagnostic or service call cost?",
    expectedChunkIds: [CHUNK.DIAGNOSTIC],
  },
  {
    id: "q-hourly",
    question: "What is your hourly labor rate?",
    expectedChunkIds: [CHUNK.HOURLY],
  },
  {
    id: "q-payment",
    question: "What forms of payment do you accept?",
    expectedChunkIds: [CHUNK.PAYMENT],
  },
  {
    id: "q-financing",
    question: "Can I finance a new system installation?",
    expectedChunkIds: [CHUNK.FINANCING],
  },
  {
    id: "q-labor-warranty",
    question: "Is there a warranty on your repair work?",
    expectedChunkIds: [CHUNK.LABOR_WARRANTY],
  },
  {
    id: "q-cancellation",
    question: "What happens if I need to cancel my appointment?",
    expectedChunkIds: [CHUNK.CANCELLATION],
  },
  {
    id: "q-guarantee",
    question: "What if I'm not satisfied with the completed repair?",
    expectedChunkIds: [CHUNK.GUARANTEE],
  },
];

/**
 * Negative probes — questions the corpus does NOT answer. Not scored for recall;
 * the harness reports their top similarity so the relevance-threshold work (#97) can
 * later assert these fall below the cutoff (no confident false answer).
 */
export const NEGATIVE_QUESTIONS: Array<{ id: string; question: string }> = [
  { id: "nq-taxes", question: "Can you help me file my income taxes this year?" },
  { id: "nq-petsitting", question: "Do you offer pet sitting or dog boarding services?" },
];
