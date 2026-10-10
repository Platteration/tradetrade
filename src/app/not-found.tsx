import Link from "next/link";
import { site } from "@/lib/site";

export default function NotFound() {
  return (
    <div className="page-shell">
      <header className="site-header"><Link className="wordmark" href="/">{site.name}.</Link></header>
      <main id="main" className="hero">
        <p className="eyebrow">404</p>
        <h1>Page not found.</h1>
        <p className="intro">This page doesn’t exist. <Link href="/">Return home</Link>.</p>
      </main>
    </div>
  );
}
