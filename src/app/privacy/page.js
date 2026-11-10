import Link from "next/link";

export const metadata = {
  title: "Privacy policy | Genbooks",
  description: "How Genbooks collects, uses and protects your personal information.",
};

// Written to match what the site actually does (checked against the code
// on 2026-10-15). Update it whenever data handling changes: a new service
// provider, a new kind of data, analytics, marketing email, or a change to
// how long anything is kept.
const LAST_UPDATED = "15 October 2026";

const PROVIDERS = [
  ["Google Firebase", "Accounts, sign-in and our database. Our database is stored in London; sign-in data may be processed in the United States."],
  ["Google Gemini", "The AI that writes and designs your book. It receives your book details, including your author bio. On our paid plan Google does not use this to train its AI; it keeps it briefly to detect misuse and meet legal duties."],
  ["Vercel", "Hosts the website. Its servers keep short-lived technical logs, including IP addresses. United States."],
  ["Stripe", "Takes payments. Stripe collects your card details directly; we never see or store them. We receive your email address and whether the payment succeeded."],
  ["Cloudflare Turnstile", "The \"are you human\" check on our forms. It uses your IP address and basic browser information to spot automated abuse."],
  ["Zoho Mail", "Sends and receives our emails, including support messages and \"your book is ready\" emails. United States."],
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <p className="mono-label">Legal</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Privacy policy</h1>
      <p className="mt-2 text-sm text-white/50">Last updated {LAST_UPDATED}</p>

      <div className="mt-10 flex flex-col gap-10 text-[15px] leading-7 text-white/75">
        <Section title="Who we are">
          <p>
            Genbooks is responsible for your personal information under
            UK data protection law (the UK GDPR and the Data Protection Act 2018). For anything about your
            privacy, email{" "}
            <a href="mailto:support@genbooks.example" className="text-white underline">support@genbooks.example</a>.
          </p>
        </Section>

        <Section title="What we collect">
          <List
            items={[
              ["Your account", "your name, email address and password. Passwords are stored by Google Firebase in scrambled (hashed) form; we can never see them."],
              ["Your book request", "everything you type into the book form (title, author name, author bio, description and so on), and the preview, chapters, covers and files we create from it."],
              ["Payments", "your email address and whether your payment went through. Card details go straight to Stripe."],
              ["Support messages", "your name, email address and message when you contact us."],
              ["Abuse prevention", "your IP address and a random ID stored in your browser, used only to limit free previews to one account per week."],
              ["A session ID", "when you first visit, we give your browser a random ID so the site works before you register. It has no name or email attached."],
            ]}
          />
        </Section>

        <Section title="How we use it, and why we are allowed to">
          <List
            items={[
              ["To provide what you ask for", "creating your account, writing your preview and book, taking payment, delivering your files and emailing you about your account and book. The legal basis is our contract with you."],
              ["To stop abuse", "limiting free previews per person and blocking automated or throwaway sign-ups. The legal basis is our legitimate interest in keeping the service fair and affordable."],
              ["To help you", "answering support messages. The legal basis is our legitimate interest in supporting customers, or our contract with you."],
              ["To meet the law", "keeping records of payments for tax purposes. The legal basis is our legal obligation."],
            ]}
          />
          <p className="mt-4">
            We do not sell your information, we do not use it for advertising, and we do not send marketing
            emails. The only emails we send are about your account, your book and your support requests.
          </p>
        </Section>

        <Section title="Automatic checks on free previews">
          <p>
            To keep free previews fair, our system automatically checks whether a preview has already been made
            this week from the same internet connection, browser or email address, and whether you have already
            replaced a book this week. If a check stops you, nothing else about your account is affected. If you
            think a check got it wrong, email us and a person will look at it.
          </p>
        </Section>

        <Section title="AI and what you put in your book">
          <p>
            Your book is written with Google&apos;s Gemini AI, so the details you type into the book form are
            sent to Google to create it. Please do not include sensitive information, such as details about
            someone&apos;s health, or anyone else&apos;s personal information, unless you have their permission
            to share it.
          </p>
        </Section>

        <Section title="Who we share it with">
          <p>We use these trusted providers to run Genbooks. Each one only gets what it needs for its job:</p>
          <ul className="mt-4 flex flex-col gap-3">
            {PROVIDERS.map(([name, what]) => (
              <li key={name}>
                <span className="font-semibold text-white">{name}:</span> {what}
              </li>
            ))}
          </ul>
          <p className="mt-4">
            Where information is handled outside the UK, our providers protect it with safeguards approved under UK
            law, such as the UK International Data Transfer Addendum or the UK-US data bridge. We will also share
            information if the law requires us to.
          </p>
        </Section>

        <Section title="How long we keep it">
          <List
            items={[
              ["IP addresses and browser IDs", "deleted automatically after 90 days."],
              ["Your account and books", "kept until you ask us to delete them, so you can come back and download your book."],
              ["Payment records", "kept for as long as UK tax law requires, normally up to 6 years."],
              ["Support messages", "kept while we help you, and deleted when you ask."],
              ["Technical logs", "kept by our hosting provider for a short time only."],
            ]}
          />
        </Section>

        <Section title="Cookies and browser storage">
          <p>
            We only store what the site needs to work: keeping you signed in, the &ldquo;are you human&rdquo;
            check, and the random ID that limits free previews. These are strictly necessary, so we do not ask
            for consent. We do not use analytics, advertising or tracking cookies.
          </p>
        </Section>

        <Section title="Your rights">
          <p>You have the right to:</p>
          <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5">
            <li>get a copy of the information we hold about you;</li>
            <li>have it corrected if it is wrong;</li>
            <li>have it deleted;</li>
            <li>limit or object to how we use it;</li>
            <li>receive it in a format you can take elsewhere.</li>
          </ul>
          <p className="mt-4">
            Email{" "}
            <a href="mailto:support@genbooks.example" className="text-white underline">support@genbooks.example</a> and we
            will reply within 2 business days.
          </p>
        </Section>

        <Section title="Keeping it safe">
          <p>
            Your information is sent over encrypted connections and access to our systems is restricted. Your
            books and files can only be opened by your own account, and by us when we need to help with your
            order.
          </p>
        </Section>

        <Section title="Children">
          <p>Genbooks is not for children. You must be 18 or over to use it.</p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we change how we handle your information, we will update this page and the date at the top. If a
            change is significant, we will tell you by email.
          </p>
        </Section>

        <p className="text-sm text-white/50">
          Questions? <Link href="/support" className="underline hover:text-white/80">Contact support</Link>.
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function List({ items }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map(([label, text]) => (
        <li key={label}>
          <span className="font-semibold text-white">{label}:</span> {text}
        </li>
      ))}
    </ul>
  );
}
