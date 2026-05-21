// Notification Service for Contndr Platform
// Handles browser notifications and in-app notification management

export type NotificationType =
  | 'email_clicked'
  | 'email_opened'
  | 'email_replied'
  | 'campaign_completed'
  | 'high_engagement'
  | 'new_lead'
  | 'milestone'
  | 'followup_sent'
  | 'campaign_resumed'
  | 'cron_summary'
  | 'ai_call_completed'
  | 'deal_won'
  | 'payment_failed'
  | 'system';

export interface NotificationData {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  metadata?: any;
}

class NotificationService {
  private listeners: ((notification: NotificationData) => void)[] = [];
  private notificationHistory: NotificationData[] = [];
  private maxHistorySize = 50;

  constructor() {
    // Load notification history from localStorage
    this.loadHistory();
  }

  // Request browser notification permission
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('Browser does not support notifications');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }

    return false;
  }

  // Check if notifications are enabled
  isEnabled(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  // Show a notification — visibility-aware so users don't get hit
  // by an in-app toast AND a system push for the same event.
  //
  // Standard pattern (matches Slack / Linear / Notion):
  //   • Tab is FOCUSED + VISIBLE → in-app toast only. User is right
  //     here, no reason to spawn a heavy OS-level popup.
  //   • Tab is HIDDEN / BACKGROUNDED → browser/OS notification only.
  //     User isn't looking, the in-app toast would never be seen.
  notify(type: NotificationType, title: string, message: string, metadata?: any) {
    const notification: NotificationData = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      message,
      timestamp: new Date(),
      read: false,
      metadata,
    };

    // History always gets it so the bell shows accurate state
    this.notificationHistory.unshift(notification);
    if (this.notificationHistory.length > this.maxHistorySize) {
      this.notificationHistory = this.notificationHistory.slice(0, this.maxHistorySize);
    }
    this.saveHistory();

    // Resolve visibility — defaults to "visible" if the API isn't there
    const isVisible = typeof document === 'undefined'
      ? true
      : document.visibilityState !== 'hidden' && !document.hidden;

    if (isVisible) {
      // Foreground: in-app toast only
      this.listeners.forEach(listener => listener(notification));
    } else if (this.isEnabled()) {
      // Backgrounded: browser notification only
      this.showBrowserNotification(title, message, type);
    } else {
      // Backgrounded but permission denied — fall back to the in-app
      // listener so when the user returns, the bell has the entry
      this.listeners.forEach(listener => listener(notification));
    }

    // Sound on every event regardless of which surface fired — that's
    // the audible cue most users rely on, and it's consistent with
    // how Mac / iOS native apps behave.
    this.playNotificationSound();
  }

  // Show native browser notification
  private showBrowserNotification(title: string, body: string, type: NotificationType) {
    try {
      const icon = this.getIconForType(type);
      new Notification(title, {
        body,
        icon,
        badge: '/favicon.ico',
        tag: `contndr-${type}`,
        requireInteraction: type === 'email_replied' || type === 'email_clicked', // Keep important ones visible
      });
    } catch (error) {
      console.error('Error showing browser notification:', error);
    }
  }

  // Get icon based on notification type
  private getIconForType(type: NotificationType): string {
    // Using emoji data URIs for icons (works everywhere)
    const icons = {
      email_clicked: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🖱️</text></svg>',
      email_opened: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">👀</text></svg>',
      email_replied: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💬</text></svg>',
      campaign_completed: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">✅</text></svg>',
      high_engagement: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🔥</text></svg>',
      new_lead: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">👤</text></svg>',
      milestone: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎉</text></svg>',
      followup_sent: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🔁</text></svg>',
      campaign_resumed: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🔄</text></svg>',
      cron_summary: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📅</text></svg>',
      system: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⚙️</text></svg>',
    };
    return icons[type] || icons.milestone;
  }

  // Play a subtle notification sound
  private playNotificationSound() {
    try {
      // Create a subtle beep sound using Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800; // Pleasant frequency
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime); // Quiet volume
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
      // Silent fail - not critical
    }
  }

  // Subscribe to new notifications
  subscribe(listener: (notification: NotificationData) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // Get notification history
  getHistory(): NotificationData[] {
    return [...this.notificationHistory];
  }

  // Mark notification as read
  markAsRead(id: string) {
    const notification = this.notificationHistory.find(n => n.id === id);
    if (notification) {
      notification.read = true;
      this.saveHistory();
    }
  }

  // Mark all as read
  markAllAsRead() {
    this.notificationHistory.forEach(n => n.read = true);
    this.saveHistory();
  }

  // Clear all notifications
  clearAll() {
    this.notificationHistory = [];
    this.saveHistory();
  }

  // Get unread count
  getUnreadCount(): number {
    return this.notificationHistory.filter(n => !n.read).length;
  }

  // Save history to localStorage
  private saveHistory() {
    try {
      localStorage.setItem('contndr_notifications', JSON.stringify(this.notificationHistory));
    } catch (error) {
      console.error('Error saving notification history:', error);
    }
  }

  // Load history from localStorage
  private loadHistory() {
    try {
      const saved = localStorage.getItem('contndr_notifications');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Convert timestamp strings back to Date objects
        this.notificationHistory = parsed.map((n: any) => ({
          ...n,
          timestamp: new Date(n.timestamp),
        }));
      }
    } catch (error) {
      console.error('Error loading notification history:', error);
    }
  }
}

// Export singleton instance
export const notificationService = new NotificationService();

// Helper functions for common notifications
export function notifyEmailClicked(leadName: string, campaignName: string, metadata?: any) {
  notificationService.notify(
    'email_clicked',
    '🖱️ Email Clicked!',
    `${leadName} clicked a link in "${campaignName}"`,
    metadata
  );
}

export function notifyEmailOpened(leadName: string, campaignName: string, metadata?: any) {
  // Only notify for first open (high-value event)
  notificationService.notify(
    'email_opened',
    '👀 Email Opened!',
    `${leadName} opened "${campaignName}"`,
    metadata
  );
}

export function notifyEmailReplied(leadName: string, campaignName: string, metadata?: any) {
  notificationService.notify(
    'email_replied',
    '💬 EMAIL REPLY!',
    `${leadName} replied to "${campaignName}" - Check your inbox!`,
    metadata
  );
}

export function notifyCampaignCompleted(campaignName: string, stats: any) {
  notificationService.notify(
    'campaign_completed',
    '✅ Campaign Complete',
    `"${campaignName}" finished sending to all leads`,
    stats
  );
}

export function notifyHighEngagement(campaignName: string, metric: string, value: string) {
  notificationService.notify(
    'high_engagement',
    '🔥 High Engagement!',
    `"${campaignName}" hit ${value} ${metric}`,
    { campaignName, metric, value }
  );
}

export function notifyMilestone(title: string, message: string, metadata?: any) {
  notificationService.notify(
    'milestone',
    title,
    message,
    metadata
  );
}

export function notifyFollowupSent(leadName: string, campaignName: string, metadata?: any) {
  notificationService.notify(
    'followup_sent',
    '🔁 Followup Sent!',
    `A followup email was sent to ${leadName} for "${campaignName}"`,
    metadata
  );
}

export function notifyCampaignResumed(campaignName: string, metadata?: any) {
  notificationService.notify(
    'campaign_resumed',
    '🔄 Campaign Resumed',
    `"${campaignName}" has been resumed`,
    metadata
  );
}

export function notifyCronSummary(summary: string, metadata?: any) {
  notificationService.notify(
    'cron_summary',
    '📅 Cron Summary',
    summary,
    metadata
  );
}

/** AI call completed — fires after an outbound call wraps. */
export function notifyAICallCompleted(leadName: string, outcome: string, metadata?: any) {
  notificationService.notify(
    'ai_call_completed',
    '📞 AI call completed',
    `${leadName} — ${outcome}`,
    metadata,
  );
}

/** Deal won — fires when a pipeline deal moves to closed_won or a Stripe sub becomes active. */
export function notifyDealWon(customerName: string, amount: number | string, metadata?: any) {
  notificationService.notify(
    'deal_won',
    '💰 Deal won!',
    typeof amount === 'number'
      ? `${customerName} signed for $${amount.toLocaleString()}`
      : `${customerName} signed for ${amount}`,
    metadata,
  );
}

/** Payment failed — fires for the current user when their Stripe payment fails (dunning). */
export function notifyPaymentFailed(amount: number | string, attempt: number, metadata?: any) {
  notificationService.notify(
    'payment_failed',
    '⚠️ Payment failed',
    typeof amount === 'number'
      ? `$${amount.toFixed(2)} payment failed (attempt ${attempt}). Update your card to avoid losing access.`
      : `Payment failed (attempt ${attempt}). Update your card to avoid losing access.`,
    metadata,
  );
}

export function notifySystem(message: string, metadata?: any) {
  notificationService.notify(
    'system',
    '⚙️ System Notification',
    message,
    metadata
  );
}