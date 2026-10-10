import type { Metadata } from "next";
import Link from "next/link";
import { Arrow } from "@/components/arrow";
import { DesignSwitcher } from "@/components/design-switcher";
import { site } from "@/lib/site";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "After hours — Coming soon",
  icons: { icon: "/icon-alternate.svg" },
};

export default function Alternate() {
  return (
    <div className={`after-hours ${styles.page}`}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.wordmark} href="/alternate" aria-label={`${site.name} home`}>
            <span className={styles.mark}><Arrow /></span>{site.name}<span className={styles.dot}>.</span>
          </Link>
          <span className={styles.status}><span aria-hidden="true" /> In the making</span>
        </header>
        <DesignSwitcher current="alternate" />
        <main id="main" className={styles.main} tabIndex={-1}>
          <div className={styles.overline}><span>A new kind of next.</span><span>Good things change hands.</span></div>
          <div className={styles.hero}>
            <div className={styles.copy}>
              <p className={styles.eyebrow}>Something new is on its way</p>
              <h1 className={styles.title}>Something<br />worth<br /><span>exchanging.</span></h1>
              <p className={styles.intro}>A home for every trading card.<br />Organize your collection, one binder at a time.</p>
              <div className={styles.soon}><span>Coming soon</span><Arrow /></div>
              <p className={styles.collectionEntry}><a href="/portfolio">Start your card collection <span aria-hidden="true"><Arrow /></span></a><span>Cards, binders, and notes. No account needed.</span></p>
            </div>
            <div className={styles.art} aria-hidden="true">
              <div className={styles.artTop}><span>THE EXCHANGE</span><Arrow /></div>
              <svg className={styles.exchange} viewBox="0 0 400 450" fill="none">
                <circle cx="200" cy="225" r="176" stroke="currentColor" strokeWidth="1" />
                <circle cx="200" cy="225" r="140" stroke="currentColor" strokeWidth="1" />
                <path className={styles.arrowOut} d="M74 280V114H239M171 51l68 63-68 63" strokeWidth="42" strokeLinejoin="miter" />
                <path className={styles.arrowIn} d="M326 170v166H161M229 399l-68-63 68-63" strokeWidth="42" strokeLinejoin="miter" />
              </svg>
              <div className={styles.artBottom}><span>ONE THING.<br />A NEW POSSIBILITY.</span><span className={styles.artNumber}>01 / 02</span></div>
            </div>
          </div>
        </main>
        <footer className={styles.footer}><span>New perspective. Same possibilities.</span><span>More soon <Arrow /></span></footer>
      </div>
    </div>
  );
}
