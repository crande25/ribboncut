import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'RibbonCut'

interface FeedbackReceivedProps {
  message?: string
  senderEmail?: string
  feedbackId?: string
  submittedAt?: string
}

const FeedbackReceivedEmail = ({
  message,
  senderEmail,
  feedbackId,
  submittedAt,
}: FeedbackReceivedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New feedback from {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>New feedback received</Heading>
        <Text style={label}>From</Text>
        <Text style={value}>
          {senderEmail ? senderEmail : 'Anonymous (no email provided)'}
        </Text>

        <Text style={label}>Message</Text>
        <Section style={messageBox}>
          <Text style={messageText}>{message || '(empty)'}</Text>
        </Section>

        <Hr style={hr} />
        <Text style={meta}>
          {submittedAt ? `Submitted: ${submittedAt}` : null}
          {submittedAt && feedbackId ? ' · ' : ''}
          {feedbackId ? `ID: ${feedbackId}` : null}
        </Text>
        <Text style={footer}>Sent from {SITE_NAME}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: FeedbackReceivedEmail,
  subject: (data: Record<string, any>) =>
    data?.senderEmail
      ? `[${SITE_NAME}] Feedback from ${data.senderEmail}`
      : `[${SITE_NAME}] New feedback`,
  displayName: 'Feedback received',
  previewData: {
    message: 'Love the app! One small request — could you add a dark map style?',
    senderEmail: 'jane@example.com',
    feedbackId: 'abc123',
    submittedAt: new Date().toISOString(),
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
}
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = {
  fontSize: '20px',
  fontWeight: 'bold',
  color: '#0a0a0a',
  margin: '0 0 24px',
}
const label = {
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: '#888',
  margin: '16px 0 4px',
}
const value = { fontSize: '14px', color: '#0a0a0a', margin: '0 0 8px' }
const messageBox = {
  backgroundColor: '#f6f6f6',
  borderRadius: '8px',
  padding: '14px 16px',
  margin: '4px 0 8px',
}
const messageText = {
  fontSize: '14px',
  color: '#0a0a0a',
  lineHeight: '1.55',
  margin: 0,
  whiteSpace: 'pre-wrap' as const,
}
const hr = { borderColor: '#eaeaea', margin: '24px 0 12px' }
const meta = { fontSize: '12px', color: '#888', margin: '0 0 4px' }
const footer = { fontSize: '12px', color: '#aaa', margin: '8px 0 0' }
