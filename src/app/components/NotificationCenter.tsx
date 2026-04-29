import { useState, useEffect } from 'react';
import { Bell, X, Check, MousePointerClick, Eye, MessageCircle, CheckCircle, Crosshair, Users, Trophy, Settings, RotateCw, Calendar } from 'lucide-react';
import { notificationService, NotificationData, NotificationType } from '../lib/notifications';
import { authenticatedFetch } from '../lib/auth';
import { useTranslation } from 'react-i18next';
import { projectId } from '../utils/supabase/info';

export function NotificationCenter() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [serverNotifications, setServerNotifications] = useState<any[]>([]);

  useEffect(() => {
    // Load initial local notifications
    setNotifications(notificationService.getHistory());
    setUnreadCount(notificationService.getUnreadCount());
    setNotificationsEnabled(notificationService.isEnabled());

    // Sync server notifications (from cron/automation)
    syncServerNotifications();
    const syncInterval = setInterval(syncServerNotifications, 120_000); // every 2 min

    // Subscribe to new local notifications
    const unsubscribe = notificationService.subscribe(() => {
      refreshCombinedNotifications();
    });

    return () => {
      unsubscribe();
      clearInterval(syncInterval);
    };
  }, []);

  async function syncServerNotifications() {
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/notifications?limit=20`
      );
      if (response.ok) {
        const data = await response.json();
        setServerNotifications(data.notifications || []);
        refreshCombinedNotifications(data.notifications || []);
      }
    } catch (err) {
      // Silently fail - server notifications are supplementary
    }
  }

  function refreshCombinedNotifications(serverNotifs?: any[]) {
    const local = notificationService.getHistory();
    const server = (serverNotifs || serverNotifications).map((n: any) => ({
      id: `srv_${n.id}`,
      type: n.type as NotificationType,
      title: n.title,
      message: n.message,
      timestamp: new Date(n.createdAt),
      read: n.read,
      metadata: n.data,
    }));

    // Merge and deduplicate, sort by timestamp descending
    const merged = [...local, ...server.filter((sn: any) => !local.some(ln => ln.id === sn.id))];
    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const limited = merged.slice(0, 50);

    setNotifications(limited);
    setUnreadCount(limited.filter(n => !n.read).length);
  }

  useEffect(() => {
    // Mark as read when notification center is opened
    if (isOpen && unreadCount > 0) {
      const timer = setTimeout(() => {
        notificationService.markAllAsRead();
        // Also mark server notifications as read
        authenticatedFetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/notifications/read-all`,
          { method: 'POST' }
        ).catch(() => {});
        setUnreadCount(0);
      }, 2000); // Mark as read after 2 seconds of viewing
      return () => clearTimeout(timer);
    }
  }, [isOpen, unreadCount]);

  async function handleEnableNotifications() {
    const granted = await notificationService.requestPermission();
    setNotificationsEnabled(granted);
    if (granted) {
      setShowSettings(false);
      // Show test notification
      notificationService.notify(
        'milestone',
        'Notifications Enabled!',
        'You\'ll now receive alerts for clicks, opens, and major events'
      );
    } else {
      alert('Please enable notifications in your browser settings to receive alerts.');
    }
  }

  function getIconForType(type: NotificationType) {
    switch (type) {
      case 'email_clicked':
        return <MousePointerClick className="w-4 h-4 text-amber-500" />;
      case 'email_opened':
        return <Eye className="w-4 h-4 text-blue-500" />;
      case 'email_replied':
        return <MessageCircle className="w-4 h-4 text-green-500" />;
      case 'campaign_completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'high_engagement':
        return <Crosshair className="w-4 h-4 text-zinc-500" />;
      case 'new_lead':
        return <Users className="w-4 h-4 text-blue-500" />;
      case 'milestone':
        return <Trophy className="w-4 h-4 text-yellow-500" />;
      case 'followup_sent':
        return <RotateCw className="w-4 h-4 text-[#1ED4A7]" />;
      case 'campaign_resumed':
        return <RotateCw className="w-4 h-4 text-blue-500" />;
      case 'cron_summary':
        return <Calendar className="w-4 h-4 text-zinc-500" />;
      case 'system':
        return <Settings className="w-4 h-4 text-zinc-400" />;
      default:
        return <Bell className="w-4 h-4 text-gray-500" />;
    }
  }

  function formatTimestamp(timestamp: Date) {
    const now = new Date();
    const diff = now.getTime() - new Date(timestamp).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  return (
    <div className="relative">
      {/* Notification Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
      >
        <Bell className="w-4 h-4" />
        <span className="text-[13px] font-medium">Notifications</span>
        {unreadCount > 0 && (
          <span className="ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold text-white bg-red-500 rounded-full">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Panel */}
          <div className="absolute right-0 top-12 w-[420px] max-h-[600px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl z-50 flex flex-col animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                <h3 className="font-semibold text-gray-900 dark:text-white">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 text-xs font-medium text-white bg-red-500 rounded-full">
                    {unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  title="Notification settings"
                >
                  <Settings className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
                {notifications.length > 0 && (
                  <button
                    onClick={() => {
                      notificationService.clearAll();
                      setNotifications([]);
                      setUnreadCount(0);
                    }}
                    className="text-[12px] text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {/* Settings Panel */}
            {showSettings && (
              <div className="p-4 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="text-[13px] font-medium text-gray-900 dark:text-white mb-1">
                      Browser Notifications
                    </p>
                    <p className="text-[12px] text-gray-600 dark:text-gray-400 mb-3">
                      Get notified about email clicks, opens, replies, and major campaign events
                    </p>
                    {notificationsEnabled ? (
                      <div className="flex items-center gap-2 text-[12px] text-green-600 dark:text-green-400">
                        <Check className="w-4 h-4" />
                        <span>Notifications enabled</span>
                      </div>
                    ) : (
                      <button
                        onClick={handleEnableNotifications}
                        className="px-3 py-1.5 text-[12px] font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Enable Notifications
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Notification List */}
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <Bell className="w-12 h-12 text-gray-300 dark:text-gray-700 mb-3" />
                  <p className="text-[14px] text-gray-500 dark:text-gray-400 text-center mb-1">
                    No notifications yet
                  </p>
                  <p className="text-[12px] text-gray-400 dark:text-gray-500 text-center">
                    You'll be notified when emails are clicked, opened, or when automation runs
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer ${
                        !notification.read ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''
                      }`}
                      onClick={() => {
                        if (notification.id.startsWith('srv_')) {
                          // Mark server notification as read
                          const realId = notification.id.replace('srv_', '');
                          authenticatedFetch(
                            `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/notifications/${realId}/read`,
                            { method: 'POST' }
                          ).catch(() => {});
                        } else {
                          notificationService.markAsRead(notification.id);
                        }
                        notification.read = true;
                        setNotifications([...notifications]);
                        setUnreadCount(prev => Math.max(0, prev - 1));
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          {getIconForType(notification.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <p className="text-[13px] font-medium text-gray-900 dark:text-white">
                              {notification.title}
                            </p>
                            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                              {formatTimestamp(notification.timestamp)}
                            </span>
                          </div>
                          <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">
                            {notification.message}
                          </p>
                          {!notification.read && (
                            <div className="mt-2">
                              <span className="inline-block w-2 h-2 bg-blue-500 rounded-full"></span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {!notificationsEnabled && notifications.length > 0 && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border-t border-amber-200 dark:border-amber-900/50">
                <p className="text-xs text-amber-800 dark:text-amber-200 text-center">
                  Enable browser notifications to get alerted instantly
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}