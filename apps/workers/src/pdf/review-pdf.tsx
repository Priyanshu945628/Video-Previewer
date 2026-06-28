/**
 * Review-export PDF — built with @react-pdf/renderer.
 *
 * Layout philosophy: this is the artifact a freelance editor sends to
 * collaborators or archives, not a courtroom document. We optimize for
 * scannability — header, AI summary at the top, then a clean comment list
 * with frame-accurate timestamps.
 */
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { createElement, type ReactElement } from 'react';

export interface ReviewPdfInput {
  project: { id: string; name: string; clientLabel: string | null };
  assetName: string;
  versionNumber: number;
  reviewStatus: 'PENDING' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'FINAL';
  comments: Array<{
    id: string;
    timeMs: number;
    frameNumber: number | null;
    author: string;
    status: 'OPEN' | 'RESOLVED';
    body: string;
    createdAt: Date;
    replies: Array<{ author: string; body: string; createdAt: Date }>;
  }>;
  aiSummary: unknown | null;
}

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: 'Helvetica', fontSize: 11, color: '#111' },
  header: { marginBottom: 24 },
  brand: { fontSize: 10, color: '#999', textTransform: 'uppercase', letterSpacing: 2 },
  title: { fontSize: 22, fontWeight: 700, marginTop: 4 },
  meta: { color: '#555', marginTop: 4 },
  pill: {
    fontSize: 9,
    backgroundColor: '#f4f4f5',
    color: '#333',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  section: { marginTop: 18 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#222' },
  card: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 6,
    padding: 12,
    marginBottom: 10,
  },
  ts: { fontFamily: 'Courier', fontSize: 10, color: '#5b5b5b' },
  author: { fontWeight: 700, marginTop: 2 },
  body: { marginTop: 4, lineHeight: 1.45 },
  reply: { marginTop: 8, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: '#e5e5e5' },
  footer: { position: 'absolute', bottom: 24, left: 48, right: 48, color: '#aaa', fontSize: 9 },
  aiCat: { fontSize: 11, fontWeight: 700, marginTop: 6 },
  aiIssue: { marginLeft: 8, marginTop: 2 },
});

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function ReviewPdf({ data }: { data: ReviewPdfInput }): ReactElement {
  const open = data.comments.filter((c) => c.status === 'OPEN').length;
  const total = data.comments.length;

  return createElement(
    Document,
    {},
    createElement(
      Page,
      { size: 'A4', style: styles.page },
      createElement(
        View,
        { style: styles.header },
        createElement(Text, { style: styles.brand }, 'VSP · Review Export'),
        createElement(Text, { style: styles.title }, `${data.project.name} — ${data.assetName} v${data.versionNumber}`),
        createElement(
          Text,
          { style: styles.meta },
          `Client: ${data.project.clientLabel ?? '—'}    Status: ${data.reviewStatus}    Comments: ${open} open / ${total} total`,
        ),
      ),

      data.aiSummary
        ? createElement(
            View,
            { style: styles.section },
            createElement(Text, { style: styles.sectionTitle }, 'AI Summary'),
            ...renderAiSummary(data.aiSummary),
          )
        : null,

      createElement(
        View,
        { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, 'Comments'),
        ...data.comments.map((c, i) =>
          createElement(
            View,
            { style: styles.card, key: i, wrap: false },
            createElement(
              Text,
              { style: styles.ts },
              `#${i + 1}  ${fmtTime(c.timeMs)}${c.frameNumber != null ? ` (frame ${c.frameNumber})` : ''}  · ${c.status}`,
            ),
            createElement(Text, { style: styles.author }, c.author),
            createElement(Text, { style: styles.body }, c.body),
            ...c.replies.map((r, j) =>
              createElement(
                View,
                { style: styles.reply, key: `r${j}` },
                createElement(Text, { style: styles.author }, r.author),
                createElement(Text, { style: styles.body }, r.body),
              ),
            ),
          ),
        ),
      ),

      createElement(
        Text,
        { style: styles.footer, fixed: true, render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` },
      ),
    ),
  );
}

function renderAiSummary(payload: unknown): ReactElement[] {
  const p = payload as
    | {
        topPriority?: string;
        categories?: Array<{ name: string; priority: string; issues: Array<{ summary: string; timestamps: string[] }> }>;
      }
    | null;
  if (!p?.categories?.length) return [];
  const out: ReactElement[] = [];
  if (p.topPriority) {
    out.push(createElement(Text, { key: 'tp', style: { marginBottom: 6 } }, `Top priority: ${p.topPriority}`));
  }
  p.categories.forEach((cat, i) => {
    out.push(
      createElement(Text, { key: `c${i}`, style: styles.aiCat }, `${cat.name.toUpperCase()} · ${cat.priority}`),
    );
    cat.issues.forEach((iss, j) =>
      out.push(
        createElement(
          Text,
          { key: `i${i}-${j}`, style: styles.aiIssue },
          `• ${iss.summary}${iss.timestamps.length ? ` (${iss.timestamps.join(', ')})` : ''}`,
        ),
      ),
    );
  });
  return out;
}

export async function renderReviewPdf(input: ReviewPdfInput): Promise<Buffer> {
  const stream = await pdf(createElement(ReviewPdf, { data: input })).toBuffer();
  const chunks: Buffer[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}
