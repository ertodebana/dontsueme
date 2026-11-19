import { LAWS, type LawId } from './laws.ts'
import type { CheckResult, Evidence, Snapshot, Status } from './types.ts'

interface Outcome {
  status: Status
  summary: string
  evidence: Evidence[]
  fix: string
}

interface Check {
  id: string
  title: string
  law: LawId
  run: (snap: Snapshot) => Outcome
}

// ---- helpers --------------------------------------------------------------

export function find(snap: Snapshot, re: RegExp, max = 2): Evidence[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  const out: Evidence[] = []
  for (const doc of snap.docs) {
    for (const m of doc.text.matchAll(g)) {
      out.push({ where: doc.path, snippet: excerpt(doc.text, m.index ?? 0, m[0].length) })
      if (out.length >= max) return out
    }
  }
  return out
}

function excerpt(text: string, at: number, len: number): string {
  const start = Math.max(0, at - 40)
  const end = Math.min(text.length, at + len + 40)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

// Policies describe what users *might* do ("if you post a comment…"), so they
// count as evidence of notices but not of features.
const product = (snap: Snapshot): Snapshot => ({ ...snap, docs: snap.docs.filter((d) => d.kind !== 'legal') })

const anyOf =(snap: Snapshot, res: RegExp[], max = 2) => res.flatMap((re) => find(snap, re, max)).slice(0, max)

// ---- 1. COPPA age gate ----------------------------------------------------

const SIGNUP = [
  /<input[^>]*type=["']?password\b|\btype:\s*["']password["']/i, // markup or JSX, not CSS selectors
  /\bsign[\s_-]?up\b/i,
  /\bcreate (?:an? |your )?account\b/i,
  /\bcreateUserWithEmailAndPassword\b/,
]
const AGE = [
  /\bdate[\s_]of[\s_]birth\b|\bdob\b|\bbirth[\s_-]?(?:date|day|year)\b/i,
  /\b(?:13|16|18) (?:years? )?(?:or|and) (?:older|over)\b|\b(?:13|16|18)\+(?=[\s<"'.,!)]|$)/i, // "18+" but not `18+x`
  /\b(?:over|older than|at least|must be)\s+(?:the\s+age\s+of\s+)?(?:13|16|18)\b/i,
  /\bage[\s_-]?(?:gate|verification|check)\b|\b(?:verify|confirm) your age\b/i,
]

const coppa: Check = {
  id: 'coppa/age-gate',
  title: 'Age question at sign-up',
  law: 'coppa',
  run(snap) {
    const fix =
      'Ask for date of birth at sign-up (a neutral question, not a pre-ticked "I am 13+" box). ' +
      'Block under-13s or get verifiable parental consent before collecting anything. ' +
      'If your audience is adults, say so in your terms.'
    const signup = anyOf(snap, SIGNUP, 1)
    if (!signup.length) {
      return { status: 'pass', summary: 'No sign-up form detected, so no account data to gate.', evidence: [], fix }
    }
    const age = anyOf(snap, AGE, 1)
    if (age.length) {
      return { status: 'pass', summary: 'Sign-up found, and so is an age question.', evidence: [...signup, ...age], fix }
    }
    return {
      status: 'warn',
      summary:
        'Sign-up found but no age question. COPPA applies when your app is aimed at kids or you learn a user is under 13. A neutral age gate is the usual protection.',
      evidence: signup,
      fix,
    }
  },
}

// ---- 2. Google Fonts ------------------------------------------------------

const fonts: Check = {
  id: 'gdpr/google-fonts',
  title: 'Fonts loaded from Google',
  law: 'gdpr',
  run(snap) {
    const fix =
      'Self-host the font: `npm i @fontsource-variable/<family>` and import it, or put the font files in /public with an @font-face rule. ' +
      'Then delete every fonts.googleapis.com / fonts.gstatic.com link and preconnect.'
    const hits = find(snap, /fonts\.(?:googleapis|gstatic)\.com/i, 3)
    return hits.length
      ? {
          status: 'fail',
          summary: "Fonts load from Google's servers, so every visitor's IP address goes to Google before any consent.",
          evidence: hits,
          fix,
        }
      : { status: 'pass', summary: 'No Google Fonts requests in the HTML, CSS or JS we read.', evidence: [], fix }
  },
}

// ---- 3. Session replay ----------------------------------------------------

// maybe = the SDK ships recording code but it may be switched off server-side
const REPLAY: [string, RegExp, maybe?: boolean][] = [
  ['Hotjar', /\bhotjar\b|_hjSettings/i],
  ['FullStory', /\bfullstory\b|window\[['"]_fs_/i],
  ['Microsoft Clarity', /clarity\.ms\b|window\.clarity\b/i],
  ['LogRocket', /\blogrocket\b/i],
  ['Mouseflow', /\bmouseflow\b/i],
  ['Smartlook', /\bsmartlook\b/i],
  ['Lucky Orange', /\blucky[\s-]?orange\b/i],
  ['Inspectlet', /\binspectlet\b/i],
  ['PostHog (session recording)', /\bsession_recording\b|\bsessionRecording\b|\bdisable_session_recording\b/, true],
  ['Sentry Replay', /\breplayIntegration\b|@sentry\/replay/, true],
]
const CMP =
  /cookiebot|onetrust|otSDKStub|\btermly\b|iubenda|cookieyes|\bosano\b|\bklaro\b|usercentrics|didomi|cookie[-_ ]?consent/i

const replay: Check = {
  id: 'cipa/session-replay',
  title: 'Session replay without consent',
  law: 'cipa',
  run(snap) {
    const found = REPLAY.map(([name, re, maybe]) => ({ name, maybe, hits: find(snap, re, 1) })).filter((f) => f.hits.length)
    const fix =
      'Remove the recorder, or load it only after the visitor opts in through a consent banner. ' +
      'Mask every input field in the recorder settings either way.'
    if (!found.length) {
      return { status: 'pass', summary: 'No known session-replay scripts found.', evidence: [], fix }
    }
    const names = found.map((f) => f.name).join(', ')
    const evidence = found.flatMap((f) => f.hits)
    const consent = find(snap, CMP, 1)
    if (!consent.length && found.every((f) => f.maybe)) {
      return {
        status: 'warn',
        summary: `${names} SDK found. Its session recording may be off; if it is on, it needs consent first.`,
        evidence,
        fix,
      }
    }
    return consent.length
      ? {
          status: 'warn',
          summary: `Session replay (${names}) next to a consent tool. Check the recorder stays off until the visitor says yes.`,
          evidence: [...evidence, ...consent],
          fix,
        }
      : {
          status: 'fail',
          summary: `Session replay (${names}) with no consent tool detected. Recording what Californians type without consent is the pattern CIPA wiretap suits target.`,
          evidence,
          fix,
        }
  },
}

// ---- 4. CAN-SPAM (can't be seen from outside) -----------------------------

const ESP =
  /\b(?:mailchimp|convertkit|kit\.com|buttondown|sendgrid|mailerlite|beehiiv|klaviyo|postmark|loops\.so|substack|brevo|sendinblue|resend\.com)\b/i
const CAPTURE = /\bnewsletter\b|\bwait[\s-]?list\b|\bsubscribe to (?:our|the) (?:newsletter|updates)\b/i

const email: Check = {
  id: 'canspam/marketing-email',
  title: 'Marketing email footer',
  law: 'canspam',
  run(snap) {
    const evidence = [...find(snap, CAPTURE, 1), ...find(snap, ESP, 1)]
    return {
      status: 'manual',
      summary: evidence.length
        ? 'Email capture found. We cannot see the emails you send, so check them yourself.'
        : 'We cannot see the emails you send. If you send any marketing email, check it yourself.',
      evidence,
      fix:
        'Every marketing email needs a working unsubscribe link (honored within 10 business days) and your valid postal address. ' +
        'Put both in your email template footer. Receipts and password resets are exempt.',
    }
  },
}

// ---- 5. California auto-renewal -------------------------------------------

const RECURRING =
  /\bbilled (?:monthly|annually|yearly)\b|\bper (?:month|year)\b|\/\s?(?:mo|month|yr|year)\b|mode:\s*["']subscription["']|\bsubscription_data\b|\brecurring (?:billing|payments?|charges?)\b/i
const RENEWAL = /\bauto[\s-]?renew|\bautomatically renew|\brenews? (?:automatically|each|every)\b|\bcancel (?:anytime|at any time)\b/i

const renewal: Check = {
  id: 'ca-arl/renewal-terms',
  title: 'Renewal terms next to subscribe',
  law: 'arl',
  run(snap) {
    const fix =
      'Right beside the subscribe button, state the price, the billing period, that it renews automatically until cancelled, and how to cancel. ' +
      'Get an explicit yes, email a confirmation with the same terms, and offer online cancellation.'
    const recurring = find(snap, RECURRING, 2)
    if (!recurring.length) {
      return { status: 'pass', summary: 'No recurring billing detected.', evidence: [], fix }
    }
    const terms = find(snap, RENEWAL, 1)
    return {
      status: 'warn',
      summary: terms.length
        ? 'Recurring billing and renewal wording found. A static scan cannot tell whether the wording sits right next to the button, so check it.'
        : 'Recurring billing found with no renewal wording anywhere we looked.',
      evidence: [...recurring, ...terms],
      fix,
    }
  },
}

// ---- 6. DMCA agent --------------------------------------------------------

const UGC_STRONG =
  /<input[^>]+type=["']?file\b|\b(?:post|leave) a comment\b|\bcomments? (?:section|thread)\b|\buser generated\b|\bshare your (?:photos?|videos?|posts?|work|art)\b|\bpublic (?:profiles?|posts?|gallery)\b/i
const UGC_WEAK = /(?<![/.-])\bupload(?:s|ed|ing)?\b(?![/.-])/i // prose, not URL paths like /image/upload/
const DMCA = /\bdmca\b|\bdesignated (?:copyright )?agent\b|\bcopyright agent\b/i

const dmca: Check = {
  id: 'dmca/agent',
  title: 'DMCA agent for user uploads',
  law: 'dmca',
  run(snap) {
    const fix =
      'Register a designated agent at https://dmca.copyright.gov ($6, renew every 3 years). ' +
      "Publish the agent's name, address and email on a /dmca page and act on takedown notices."
    const strong = find(product(snap), UGC_STRONG, 2)
    const weak = strong.length ? [] : find(product(snap), UGC_WEAK, 1)
    if (!strong.length && !weak.length) {
      return { status: 'pass', summary: 'No uploads or public posts detected.', evidence: [], fix }
    }
    const notice = find(snap, DMCA, 1)
    if (notice.length) {
      return {
        status: 'warn',
        summary: 'User content and DMCA wording found. Check the agent is registered and current in the Copyright Office directory.',
        evidence: [...strong, ...weak, ...notice],
        fix,
      }
    }
    return strong.length
      ? {
          status: 'fail',
          summary: 'Users can upload or post publicly, and there is no DMCA agent notice. Without a registered agent you lose the safe harbor.',
          evidence: strong,
          fix,
        }
      : {
          status: 'warn',
          summary: 'Uploads mentioned and no DMCA notice found. If uploaded files are stored and shown to others, you need an agent.',
          evidence: weak,
          fix,
        }
  },
}

export const CHECKS: Check[] = [coppa, fonts, replay, email, renewal, dmca]

export function runChecks(snap: Snapshot): CheckResult[] {
  return CHECKS.map((c) => ({ id: c.id, title: c.title, law: LAWS[c.law], ...c.run(snap) }))
}
