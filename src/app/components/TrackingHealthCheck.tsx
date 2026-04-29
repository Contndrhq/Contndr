import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, TrendingUp, Mail, Eye } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';

export function TrackingHealthCheck() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkHealth();
  }, []);

  async function checkHealth() {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/emails/recent?limit=50`,
        {
          headers,
          signal: AbortSignal.timeout(8000),
        }
      );

      if (response.ok) {
        const data = await response.json();
        
        const withResendId = data.summary.withResendId;
        const opened = data.summary.opened;
        const openRate = withResendId > 0 ? (opened / withResendId) * 100 : 0;
        
        // Determine health status
        let status: 'healthy' | 'warning' | 'error';
        let message: string;
        
        if (withResendId === 0) {
          status = 'error';
          message = 'No emails sent yet';
        } else if (opened === 0 && withResendId >= 10) {
          status = 'warning';
          message = 'No opens tracked - webhook may not be working';
        } else if (openRate < 5 && withResendId >= 20) {
          status = 'warning';
          message = 'Low open rate - consider improving subject lines';
        } else if (openRate >= 15) {
          status = 'healthy';
          message = 'Excellent open rate! 🎉';
        } else if (openRate >= 10) {
          status = 'healthy';
          message = 'Good open rate';
        } else {
          status = 'warning';
          message = 'Below average open rate';
        }
        
        setHealth({
          status,
          message,
          openRate: openRate.toFixed(1),
          total: data.summary.total,
          withResendId,
          opened,
          clicked: data.summary.clicked,
        });
      }
    } catch (error: any) {
      // Silently handle network errors (expected during cold starts or offline)
      if (error?.name !== 'AbortError' && error?.name !== 'TimeoutError') {
        console.warn('[TrackingHealthCheck] Health check unavailable:', error?.message || 'Network error');
      }
    } finally {
      setLoading(false);
    }
  }

  if (loading || !health) {
    return null;
  }

  const statusConfig = {
    healthy: {
      icon: CheckCircle,
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-950/30',
      borderColor: 'border-green-200 dark:border-green-900',
    },
    warning: {
      icon: AlertCircle,
      color: 'text-amber-600 dark:text-amber-400',
      bgColor: 'bg-amber-50 dark:bg-amber-950/30',
      borderColor: 'border-amber-200 dark:border-amber-900',
    },
    error: {
      icon: XCircle,
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-50 dark:bg-red-950/30',
      borderColor: 'border-red-200 dark:border-red-900',
    },
  };

  const config = statusConfig[health.status];
  const Icon = config.icon;

  return (
    <div className={`border ${config.borderColor} ${config.bgColor} rounded-xl p-4`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 ${config.color} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className={`${config.color} font-medium text-[14px]`}>
              Email Tracking Status
            </h3>
            <button
              onClick={checkHealth}
              className={`text-xs ${config.color} hover:underline`}
            >
              Refresh
            </button>
          </div>
          
          <p className="text-gray-700 dark:text-gray-300 text-[13px] mb-3">
            {health.message}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Mail className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Sent
                </span>
              </div>
              <p className="text-[16px] font-semibold text-gray-900 dark:text-white">
                {health.withResendId}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Eye className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Opened
                </span>
              </div>
              <p className="text-[16px] font-semibold text-gray-900 dark:text-white">
                {health.opened}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Open Rate
                </span>
              </div>
              <p className="text-[16px] font-semibold text-gray-900 dark:text-white">
                {health.openRate}%
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Clicked
                </span>
              </div>
              <p className="text-[16px] font-semibold text-gray-900 dark:text-white">
                {health.clicked}
              </p>
            </div>
          </div>

          {health.status === 'warning' && health.withResendId >= 10 && health.opened === 0 && (
            <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-900">
              <p className="text-[12px] text-amber-900 dark:text-amber-100 mb-2">
                <strong>Possible Issue:</strong> Webhook may not be configured
              </p>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  // Navigate to diagnostics
                  window.dispatchEvent(new CustomEvent('navigate-to-diagnostics'));
                }}
                className="text-[12px] text-amber-700 dark:text-amber-300 hover:underline"
              >
                → Go to Diagnostics page to troubleshoot
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}