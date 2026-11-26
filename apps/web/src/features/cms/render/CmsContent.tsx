import "./cms.css";

/** `html` must come from `getCmsPage` / `getCmsBlocks`, which sanitise it. Never pass anything else. */
export function CmsContent({ html, className = "" }: { html: string; className?: string }) {
  return <div className={`cms-content ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />;
}
