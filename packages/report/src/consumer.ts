/** Intentionally public demo scenarios. Never use these as operational exam items. */
import { consumerComplete, type ConsumerAttempt, type ConsumerChoice } from "@ailx/session";
export type ConsumerSkill = "direction" | "verification" | "revision" | "oversight";
interface ConsumerQuestion {
  skill: ConsumerSkill;
  situation: string;
  sourceTitle: string;
  source: readonly string[];
  assistant: string;
  prompt: string;
  choices: readonly { id: ConsumerChoice; text: string }[];
  answer: ConsumerChoice;
  explanation: string;
}
export const CONSUMER_SKILLS: readonly { id: ConsumerSkill; name: string; verb: string }[] = [
  { id: "direction", name: "Giving direction", verb: "Direct" },
  { id: "verification", name: "Checking the work", verb: "Check" },
  { id: "revision", name: "Improving the output", verb: "Refine" },
  { id: "oversight", name: "Keeping control", verb: "Decide" },
];
export const CONSUMER_QUESTIONS: readonly ConsumerQuestion[] = [
  {
    skill: "direction", situation: "Give the assistant a useful starting point.", sourceTitle: "Your project",
    source: ["A free community repair afternoon for people with broken household items.", "Saturday, 2–4 pm. Capacity: 20 people. No repair experience needed.", "You need a short invitation. Confirmed details must stay accurate."],
    assistant: "I can help. What would you like me to make?", prompt: "Which brief gives the AI the best direction?",
    choices: [{ id: "a", text: "Write something impressive that will make this event go viral." }, { id: "b", text: "Write a 70-word invitation for local beginners. Use only these event details and make the next step clear." }, { id: "c", text: "Act as the world's best event expert and write the perfect invitation." }],
    answer: "b", explanation: "The brief names an audience, a deliverable, a length, and a factual boundary. A grand-sounding role does not supply those constraints.",
  },
  {
    skill: "direction", situation: "Choose what to hand over.", sourceTitle: "Your responsibility",
    source: ["The event details are confirmed.", "The volunteer organizer must approve the final invitation.", "The mailing list contains neighbors' contact information."],
    assistant: "I can draft the invitation, choose who receives it, and send it now.", prompt: "What do you delegate at this stage?",
    choices: [{ id: "a", text: "Draft two versions using the confirmed details. I will choose one and approve who receives it." }, { id: "b", text: "Choose the recipients and send whichever version seems most persuasive." }, { id: "c", text: "Nothing. AI cannot help with any part of this invitation." }],
    answer: "a", explanation: "Drafting is a useful, reviewable task. Recipient selection and sending remain decisions for the person responsible. Refusing all help would also miss a useful delegation.",
  },
  {
    skill: "verification", situation: "Check a confident recommendation.", sourceTitle: "Confirmed event notes",
    source: ["Entry is free. Capacity is 20 people.", "Volunteers will assess items and attempt repairs where possible.", "There is no guarantee that an item can be repaired."],
    assistant: "Bring anything broken. Our experts guarantee a repair, free of charge, for every visitor.", prompt: "Which change is required by the source?",
    choices: [{ id: "a", text: "Keep the guarantee. It makes the invitation clear and confident." }, { id: "b", text: "Remove the claim that entry is free." }, { id: "c", text: "Replace the guaranteed repair with an offer to assess items and attempt repairs where possible." }],
    answer: "c", explanation: "The notes support free entry, but explicitly rule out a repair guarantee. Check the claim against the source rather than the confidence of the wording.",
  },
  {
    skill: "verification", situation: "Recognize when the assistant is right.", sourceTitle: "Your source sheet",
    source: ["Saturday, 2–4 pm.", "20 places available.", "No prior repair experience required."],
    assistant: "The event lasts two hours and beginners can attend.", prompt: "What is the appropriate response?",
    choices: [{ id: "a", text: "Reject it because AI-generated statements are unreliable." }, { id: "b", text: "Accept this statement: both parts are supported by the source sheet." }, { id: "c", text: "Accept it because the assistant sounds certain, without looking at the source." }],
    answer: "b", explanation: "Appropriate trust includes accepting supported work. Both the duration and the beginner-friendly description follow directly from the supplied notes.",
  },
  {
    skill: "revision", situation: "Make the draft fit its audience.", sourceTitle: "The communication goal",
    source: ["Invite local people who have never repaired anything before.", "Keep the wording welcoming and specific.", "Do not invent services or promises."],
    assistant: "Join an elite circular-economy activation leveraging technical remediation expertise.", prompt: "Which revision most directly addresses the problem?",
    choices: [{ id: "a", text: "Replace the jargon with plain language for beginners. Say they can bring an item for volunteers to assess." }, { id: "b", text: "Make it more professional and impactful." }, { id: "c", text: "Add a promise that everyone will leave with a fully repaired item." }],
    answer: "a", explanation: "A useful revision identifies what is wrong and what should replace it. Here the problem is jargon that excludes the intended audience, not a lack of impressive language.",
  },
  {
    skill: "revision", situation: "Review the revision against the brief.", sourceTitle: "Final requirements",
    source: ["State the day and time: Saturday, 2–4 pm.", "State the limit of 20 places.", "Welcome beginners without promising a successful repair."],
    assistant: "New to fixing things? Join our free repair afternoon this Saturday. Bring an item for our volunteers to assess. We have 20 places.", prompt: "What should you ask the assistant to fix next?",
    choices: [{ id: "a", text: "Start again with a completely different tone." }, { id: "b", text: "Nothing. A friendly tone means the brief is satisfied." }, { id: "c", text: "Add 2–4 pm. Keep the useful wording and the existing factual limits." }],
    answer: "c", explanation: "The revision meets most requirements but omits the time. A targeted correction preserves useful work while fixing the specific gap.",
  },
  {
    skill: "oversight", situation: "Notice what the agent would expose.", sourceTitle: "Before sending",
    source: ["You approved the invitation text.", "The spreadsheet includes names, email addresses, and private access requests.", "You have not approved any attachments."],
    assistant: "Ready to email the invitation. I have attached the full registration spreadsheet so everyone can coordinate.", prompt: "What should happen before the agent sends it?",
    choices: [{ id: "a", text: "Send it. The invitation text was already approved." }, { id: "b", text: "Remove the spreadsheet and review recipients and attachments before approving the send." }, { id: "c", text: "Ask the agent to hide the spreadsheet's filename and then send it." }],
    answer: "b", explanation: "Approval of the text is not approval to distribute personal information. Review the actual action, including its recipients and attachments.",
  },
  {
    skill: "oversight", situation: "Tell a proposed action from a completed one.", sourceTitle: "Agent activity log",
    source: ["Invitation draft: saved.", "Recipient list: prepared.", "Send email: not run; waiting for your approval."],
    assistant: "Everything is ready. Your neighbors are all set!", prompt: "What can you conclude from the activity log?",
    choices: [{ id: "a", text: "The invitation is prepared but has not been sent. Review it before approving the action." }, { id: "b", text: "The neighbors have received the invitation." }, { id: "c", text: "The invitation was sent, but the neighbors have not opened it yet." }],
    answer: "a", explanation: "A conversational summary can imply more than the action log supports. The log records preparation and an approval wait, not a completed send.",
  },
];

export const CONSUMER_PROFILES = {
  direction: { name: "The purposeful maker", art: "MSAE", line: "Your clearest decisions gave the assistant a useful job and a boundary." },
  verification: { name: "The careful detective", art: "MSVE", line: "Your clearest decisions separated supported work from confident mistakes." },
  revision: { name: "The thoughtful editor", art: "PSVE", line: "Your clearest decisions turned a vague output into something closer to the brief." },
  oversight: { name: "The attentive navigator", art: "MSVD", line: "Your clearest decisions kept the agent's actions within what you approved." },
  balanced: { name: "The adaptable collaborator", art: "PTAD", line: "You met the intended decision in every situation in this short run." },
  mixed: { name: "The open explorer", art: "PTAE", line: "This run shows a mix of approaches. Your individual decisions tell the more useful story below." },
};

export const CONSUMER_METRICS = [
  { name: "Briefing", decisions: [0] },
  { name: "Delegation", decisions: [1] },
  { name: "Checking", decisions: [2, 3] },
  { name: "Refinement", decisions: [4, 5] },
  { name: "Boundaries", decisions: [6] },
  { name: "Follow-through", decisions: [7] },
] as const;

export function consumerResult(attempt: ConsumerAttempt) {
  if (!consumerComplete(attempt)) return { kind: "incomplete" as const };
  const decisions = CONSUMER_QUESTIONS.map((q, index) => ({
    ...q, choice: attempt.responses[index], matched: attempt.responses[index] === q.answer,
  }));
  const skills = CONSUMER_SKILLS.map(skill => ({
    ...skill, matched: decisions.filter(d => d.skill === skill.id && d.matched).length, total: 2,
  }));
  const metrics = CONSUMER_METRICS.map(metric => ({
    name: metric.name,
    matched: metric.decisions.filter(index => decisions[index].matched).length,
    total: metric.decisions.length,
  }));
  const highest = Math.max(...skills.map(s => s.matched));
  const leaders = skills.filter(s => s.matched === highest);
  const profile = skills.every(s => s.matched === 2) ? CONSUMER_PROFILES.balanced
    : leaders.length === 1 ? CONSUMER_PROFILES[leaders[0].id] : CONSUMER_PROFILES.mixed;
  const next = skills.find(s => s.matched < 2)?.id ?? "oversight";
  return { kind: "complete" as const, profile, skills, metrics, decisions, next };
}

export const CONSUMER_FOLLOWUPS: Record<ConsumerSkill, { title: string; task: string; example: string }> = {
  direction: { title: "Give AI a better brief", task: "Pick a small task you actually have. Write a brief with the audience, desired output, and one boundary the assistant must respect.", example: "Draft a 100-word reminder for our volunteers. Use the dates below, ask for a reply by Friday, and do not invent missing details." },
  verification: { title: "Check one claim before using it", task: "Take an AI answer and choose one factual claim. Find its supporting source. Decide whether the source supports the exact claim or only part of it.", example: "A source says a service is free for students. That does not support a draft saying it is free for everyone." },
  revision: { title: "Make one targeted revision", task: "Choose a draft you want to improve. Name one specific gap between the draft and your goal, then write the revision instruction.", example: "Keep the facts and structure. Replace the jargon in the opening paragraph with words a first-time visitor would understand." },
  oversight: { title: "Review an agent's next action", task: "Before an AI tool sends, publishes, or changes something, check its destination, the exact content, and what access it needs. Name what you would approve.", example: "Approve saving the draft. Require a separate review of recipients and attachments before sending it." },
};
