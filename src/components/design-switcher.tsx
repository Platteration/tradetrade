import Link from "next/link";
import styles from "./design-switcher.module.css";

export function DesignSwitcher({ current }: { current: "original" | "alternate" }) {
  return (
    <nav className={styles.switcher} aria-label="Design versions">
      <span className={styles.label}>Two ways to see it</span>
      <div className={styles.links}>
        <Link href="/" aria-current={current === "original" ? "page" : undefined}>A — Original</Link>
        <Link href="/alternate" aria-current={current === "alternate" ? "page" : undefined}>B — After hours</Link>
      </div>
    </nav>
  );
}
