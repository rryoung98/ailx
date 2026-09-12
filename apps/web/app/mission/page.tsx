import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Foray | Our mission",
  description: "AI literacy should belong to everyone. Understand AI, use it on your terms, and have a voice in what comes next.",
};

export default function MissionPage() {
  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">OUR MISSION</p>
        <h1 style={{ maxWidth: "18ch" }}>The future of AI needs more people in the room.</h1>
        <div style={{ maxWidth: "62ch" }}>
          <p className="lede">AI literacy should belong to everyone.</p>
          <p>AI is changing how we work and live. People need a way to understand it and use it now. We cannot wait years for education systems to catch up.</p>
          <p>Foray helps people try AI, question its answers, and build their own judgment. Our aim is to make that opportunity accessible across communities and countries.</p>
          <p>People also deserve a voice in how AI is used and measured. That means open methods, public discussion, and evidence people can question.</p>
          <p><strong>More people able to participate. More people able to shape what comes next.</strong></p>
          <p><Link className="btn primary" href="/test">Find my AI profile →</Link></p>
        </div>
      </div>
    </main>
  );
}
