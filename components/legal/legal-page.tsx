import Link from "next/link";
import { LEGAL_DOCUMENTS, type LegalDocumentSlug } from "@/lib/legal/documents";

export function LegalPage({ slug }: { slug: LegalDocumentSlug }) {
  const document = LEGAL_DOCUMENTS[slug];

  return (
    <main className="legal-page">
      <header className="legal-page-header">
        <div>
          <p className="legal-page-kicker">StackChips · Legal</p>
          <h1>{document.title}</h1>
          <p className="legal-page-meta">Current version: {document.version}</p>
        </div>
        <Link className="legal-page-back" href="/legal">All legal documents</Link>
      </header>

      <article className="legal-page-document">
        {document.body.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </article>

      <footer className="legal-page-footer">
        <Link href="/">Back to StackChips</Link>
        <a href="mailto:support@stackchips.app">Questions? Contact support</a>
      </footer>
    </main>
  );
}
