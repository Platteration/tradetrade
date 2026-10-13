import type { Metadata } from "next";
import { Arrow } from "@/components/arrow";
import { accountProviders } from "@/lib/authentication-server";
import { site } from "@/lib/site";
import styles from "./account.module.css";

export const metadata: Metadata = {
  title: "Your account",
  description: "Keep collecting on your device. Optional Google and Apple sign-in is planned; accounts and synchronization are not connected yet.",
};

export default function AccountPage() {
  const providers = accountProviders();
  return <div className={styles.page}>
    <header className={styles.header}>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Document navigation preserves unsaved-work guards when returning from a workspace. */}
      <a className="wordmark" href="/" aria-label={`${site.name} home`}><span className="brand-mark" aria-hidden="true"><Arrow /></span>{site.name}<span className="wordmark-dot">.</span></a>
      <nav aria-label="Main navigation" className={styles.navigation}>
        <a href="/inventory">Portfolio</a>
        <a href="/portfolio">Trading cards</a>
        <a href="/alerts">Price alerts</a>
        <a href="/sources">Website sources</a>
      </nav>
    </header>
    <main id="main" tabIndex={-1} className={styles.main}>
      <p className={styles.eyebrow}>Collect at your own pace</p>
      <h1>Your account</h1>
      <p className={styles.intro}>Keep collecting without an account. Your portfolios stay in this browser.</p>
      <div className={styles.layout}>
        <section className={styles.signIn} aria-labelledby="account-sign-in">
          <div className={styles.sectionHeading}><h2 id="account-sign-in">Optional sign-in</h2><span>Coming later</span></div>
          <p>Google and Apple sign-in are not connected yet. You can keep adding items, recording values, and saving backups on this device.</p>
          <div className={styles.providers}>
            {providers.map((provider) => <div key={provider.id} className={styles.provider}>
              <div className={styles.providerHeading}><h3>{provider.name}</h3><span>Not connected</span></div>
              <button type="button" disabled={!provider.enabled} aria-describedby={`account-${provider.id}-status`}>
                Continue with {provider.name}
              </button>
              <p id={`account-${provider.id}-status`}>{provider.name} sign-in will become available after accounts are connected.</p>
            </div>)}
          </div>
          <p className={styles.privacy}>Nothing is uploaded from your collection by visiting this page. Account sign-in and synchronization are not available in this version.</p>
        </section>
        <aside className={styles.device} aria-labelledby="account-device">
          <span className={styles.deviceMark} aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="12" y="5" width="24" height="38" rx="4" /><path d="M19 10h10M21 37h6M18 23l4 4 9-10" /></svg></span>
          <h2 id="account-device">Your collection, on this device</h2>
          <p>No account is needed to use any of your portfolios. Another browser, device, or website address has its own storage.</p>
          <a className={styles.primary} href="/inventory">Go to your portfolio <Arrow /></a>
          <div className={styles.backups}>
            <h3>Keep a backup</h3>
            <p>Clearing website data can remove your saved items. Export a backup from each workspace before changing browsers or devices.</p>
            <a href="/portfolio">Trading cards and binders <Arrow /></a>
            <a href="/alerts">Graded-card price alerts <Arrow /></a>
            <a href="/sources">Website sources <Arrow /></a>
          </div>
        </aside>
      </div>
    </main>
    <footer className={styles.footer}><span>A collection that stays yours.</span><span>Saved on this device · No account needed</span></footer>
  </div>;
}
