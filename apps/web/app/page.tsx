import Link from "next/link";
import { FunnelStep } from "../components/FunnelStep";
import styles from "../features/landing/Home.module.css";

export default function Home() {
  return <main className={`page ${styles.home}`}>
    <FunnelStep step="landing_viewed" />
    <section className={`container ${styles.hero}`}>
      <div className={styles.intro}>
        <p className="eyebrow">AI LITERACY, FOR EVERYONE</p>
        <h1>How do you work <em>with AI?</em></h1>
        <p className={`lede ${styles.lede}`}>Make eight decisions. Discover your approach and what to try next.</p>
        <p className={styles.invitation}><Link className="btn primary" href="/test">Find my AI profile →</Link></p>
        <p className={styles.note}>About 4–5 minutes · No timer · No account</p>
        <p className={styles.continue}><Link href="/me">Return to my activity →</Link></p>
      </div>
      <div className={styles.play}>
        <p className="eyebrow">YOUR FIRST CHALLENGE</p>
        <h2>A little direction goes a long way.</h2>
        <p>Help an AI assistant prepare a community invitation. Give it a brief, check its work, and decide what happens next.</p>
        <p className={styles.note}>A public scenario demo. Your result reflects the choices you make in this run.</p>
      </div>
    </section>
    <section className={`container ${styles.next}`}>
      <div><h2>Your choices tell a story.</h2><p>Get a personal profile, explore six signals, and revisit your results over time.</p></div>
      <div><h3>Want a quick practice round?</h3><p>Try spotting an AI-generated image, with feedback after each choice.</p><Link href="/practice">Try image practice →</Link></div>
    </section>
    <section className={styles.mission}><div className={`container ${styles.missionInner}`}><h2>AI should be something we shape together.</h2><p>Everyone deserves the chance to understand it, use it, and have a say in its future.</p><Link href="/mission">Our mission →</Link></div></section>
  </main>;
}
