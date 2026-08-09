import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_DOCUMENTS, legalDocumentPath } from "@/lib/legal/documents";

export const metadata: Metadata = {
  title: "Legal · StackChips",
  description: "StackChips terms, purchase disclosure, and app disclaimer.",
};

export default function LegalIndexPage() {
  return (
    <main className="legal-page legal-index">
      <header className="legal-page-header">
        <div>
          <p className="legal-page-kicker">StackChips · Legal</p>
          <h1>Disclosures</h1>
          <p className="legal-page-intro">
            The terms and purchase information that apply when you use StackChips.
          </p>
        </div>
        <Link className="legal-page-back" href="/">Back to StackChips</Link>
      </header>

      <nav className="legal-document-list" aria-label="Legal documents">
        {(Object.keys(LEGAL_DOCUMENTS) as Array<keyof typeof LEGAL_DOCUMENTS>).map((slug) => {
          const document = LEGAL_DOCUMENTS[slug];
          return (
            <Link className="legal-document-link" href={legalDocumentPath(slug)} key={slug}>
              <span>
                <strong>{document.title}</strong>
                <small>Version {document.version}</small>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          );
        })}
      </nav>
    </main>
  );
}
