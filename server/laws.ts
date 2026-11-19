import type { LawInfo } from './types.ts'

// Figures checked against primary sources in Nov 2026. FTC amounts are the
// 2025 inflation adjustment (the 2026 adjustment cycle was cancelled).
export const LAWS = {
  coppa: {
    id: 'coppa',
    name: 'COPPA (US, children under 13)',
    exposure: 'up to $53,088 in civil penalties per violation',
    asOf: '2025 FTC adjustment',
    source: {
      label: 'FTC civil penalty adjustments, 90 FR 5580',
      url: 'https://www.federalregister.gov/documents/2025/01/17/2025-01361/adjustments-to-civil-penalty-amounts',
    },
  },
  gdpr: {
    id: 'gdpr',
    name: 'GDPR (EU visitors)',
    exposure: '€100 damages per visitor in LG München I, 3 O 17493/20, plus a wave of warning letters since',
    asOf: 'Jan 2022 ruling',
    source: {
      label: 'LG München I, 20.01.2022, 3 O 17493/20',
      url: 'https://www.gesetze-bayern.de/Content/Document/Y-300-Z-BECKRS-B-2022-N-612',
    },
  },
  cipa: {
    id: 'cipa',
    name: 'CIPA (California wiretap law)',
    exposure: '$5,000 per violation in private suits',
    asOf: 'Cal. Penal Code §637.2',
    source: {
      label: 'Cal. Penal Code §637.2',
      url: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PEN&sectionNum=637.2',
    },
  },
  canspam: {
    id: 'canspam',
    name: 'CAN-SPAM Act (US)',
    exposure: 'up to $53,088 per non-compliant email',
    asOf: '2025 FTC adjustment',
    source: {
      label: 'FTC CAN-SPAM compliance guide',
      url: 'https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business',
    },
  },
  arl: {
    id: 'arl',
    name: 'California Automatic Renewal Law',
    exposure: 'renewals treated as an unconditional gift, so you may owe the money back',
    asOf: 'Cal. Bus. & Prof. Code §17603',
    source: {
      label: 'Cal. Bus. & Prof. Code §17600–17606',
      url: 'https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=BPC&division=7.&chapter=1.&part=3.&article=9.',
    },
  },
  dmca: {
    id: 'dmca',
    name: 'DMCA safe harbor (17 U.S.C. §512)',
    exposure: 'no safe harbor for user uploads; statutory damages up to $150,000 per work if willful',
    asOf: '17 U.S.C. §504(c)',
    source: {
      label: 'Copyright Office DMCA agent directory',
      url: 'https://dmca.copyright.gov/',
    },
  },
} satisfies Record<string, LawInfo>

export type LawId = keyof typeof LAWS
