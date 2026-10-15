export interface WebhookAlertPayload {
  eventType:
    | 'circuit_tripped'
    | 'circuit_recovered'
    | 'budget_downgrade'
    | 'budget_exhausted'
    | 'loop_terminated'
    | 'killswitch_toggled';
  title: string;
  summary: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  metadata: Record<string, unknown>;
  timestamp: number;
}

export class WebhookDispatcher {
  private webhookUrl?: string;
  private isEnabled: boolean;
  private deliveryHistory: Array<{ timestamp: number; success: boolean; eventType: string }> = [];

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl || process.env.WEBHOOK_URL;
    this.isEnabled = Boolean(this.webhookUrl);
  }

  public setWebhookUrl(url?: string): void {
    this.webhookUrl = url;
    this.isEnabled = Boolean(url);
  }

  public getWebhookUrl(): string | undefined {
    return this.webhookUrl;
  }

  public async dispatch(alert: Omit<WebhookAlertPayload, 'timestamp'>): Promise<boolean> {
    if (!this.isEnabled || !this.webhookUrl) {
      return false;
    }

    const payload: WebhookAlertPayload = {
      ...alert,
      timestamp: Date.now()
    };

    // Slack-compatible payload structure
    const isSlack = this.webhookUrl.includes('slack.com');
    const isDiscord = this.webhookUrl.includes('discord.com');

    let body: any;

    if (isSlack) {
      const color =
        alert.severity === 'CRITICAL'
          ? '#ef4444'
          : alert.severity === 'WARNING'
          ? '#f59e0b'
          : '#10b981';

      body = {
        text: `*[TokenCircuit Alert]* ${alert.title}`,
        attachments: [
          {
            color,
            title: alert.title,
            text: alert.summary,
            fields: Object.entries(alert.metadata).map(([k, v]) => ({
              title: k,
              value: String(v),
              short: true
            })),
            footer: 'TokenCircuit Gateway',
            ts: Math.floor(payload.timestamp / 1000)
          }
        ]
      };
    } else if (isDiscord) {
      const color =
        alert.severity === 'CRITICAL'
          ? 0xef4444
          : alert.severity === 'WARNING'
          ? 0xf59e0b
          : 0x10b981;

      body = {
        content: `**[TokenCircuit Alert]** ${alert.title}`,
        embeds: [
          {
            title: alert.title,
            description: alert.summary,
            color,
            fields: Object.entries(alert.metadata).map(([k, v]) => ({
              name: k,
              value: String(v),
              inline: true
            })),
            timestamp: new Date(payload.timestamp).toISOString()
          }
        ]
      };
    } else {
      // Standard JSON Webhook
      body = payload;
    }

    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000)
      });

      const success = res.ok;
      this.deliveryHistory.unshift({ timestamp: Date.now(), success, eventType: alert.eventType });
      if (this.deliveryHistory.length > 50) this.deliveryHistory.pop();
      return success;
    } catch {
      this.deliveryHistory.unshift({ timestamp: Date.now(), success: false, eventType: alert.eventType });
      if (this.deliveryHistory.length > 50) this.deliveryHistory.pop();
      return false;
    }
  }

  public getHistory(): Array<{ timestamp: number; success: boolean; eventType: string }> {
    return this.deliveryHistory;
  }
}
