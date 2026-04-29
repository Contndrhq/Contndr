import { useEffect, useState } from 'react';
import { MessageSquare, Clock, XCircle, Mail, User, Building2, ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import { LoadingSpinner } from './LoadingSpinner';

interface Reply {
  id: string;
  lead_id: string;
  from_email: string;
  subject: string;
  body: string;
  received_at: string;
  sentiment?: string;
  lead_business_name?: string;
}

export function RepliesView() {
  const { t } = useTranslation();
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReply, setSelectedReply] = useState<Reply | null>(null);

  useEffect(() => {
    loadAllReplies();
  }, []);

  async function loadAllReplies() {
    try {
      const headers = await getAuthHeaders();
      
      // Fetch all replies from the server
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/replies/all`,
        { headers }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to load replies:', errorText);
        throw new Error('Failed to load replies');
      }
      
      const data = await response.json();
      setReplies(data.replies || []);
    } catch (error) {
      console.error('Error loading replies:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <LoadingSpinner center size="lg" />;
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-sm">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-black">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('repliesView.title')}</h2>
        <span className="text-xs text-gray-500">{t('repliesView.received', { count: replies.length })}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50/30 dark:bg-black">
        {replies.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-12 text-center">
            <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-900 rounded-full flex items-center justify-center mb-4">
              <MessageSquare className="w-6 h-6 text-zinc-400" />
            </div>
            <p className="text-sm font-medium text-zinc-900 dark:text-white">{t('repliesView.noReplies')}</p>
            <p className="text-xs text-zinc-500 mt-1">{t('repliesView.leadsRespond')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800/50">
            {replies.map(reply => (
              <div
                key={reply.id}
                onClick={() => setSelectedReply(reply)}
                className="group p-4 hover:bg-white dark:hover:bg-gray-900 cursor-pointer transition-all border-l-2 border-transparent hover:border-black dark:hover:border-white"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {reply.sentiment && (
                        <SentimentBadge sentiment={reply.sentiment} />
                      )}
                      <span className="text-xs text-gray-400">
                        {new Date(reply.received_at).toLocaleString()}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {reply.lead_business_name || reply.from_email}
                      </h3>
                      {reply.lead_business_name && (
                        <span className="text-xs text-gray-400 truncate hidden sm:inline">
                          ({reply.from_email})
                        </span>
                      )}
                    </div>
                    
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate mb-0.5">
                      Re: {reply.subject.replace(/^Re:\s*/i, '')}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-lg">
                      {reply.body}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors opacity-0 group-hover:opacity-100" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reply Details Modal */}
      {selectedReply && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4" 
          onClick={() => setSelectedReply(null)}
        >
          <div 
            className="bg-white dark:bg-gray-900 rounded-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto border border-gray-200 dark:border-gray-800 shadow-2xl animate-scale-in flex flex-col" 
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-black sticky top-0 z-10">
              <div className="flex items-center gap-3">
                {selectedReply.sentiment && (
                  <SentimentBadge sentiment={selectedReply.sentiment} />
                )}
                <span className="text-xs text-gray-500">
                  {t('repliesView.receivedAt', { date: new Date(selectedReply.received_at).toLocaleString() })}
                </span>
              </div>
              <button 
                onClick={() => setSelectedReply(null)} 
                className="text-gray-400 hover:text-black dark:hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
              <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-800">
                 <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-gray-500">
                   <User className="w-5 h-5" />
                 </div>
                 <div className="flex-1">
                   <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                     {selectedReply.lead_business_name || t('repliesView.unknownBusiness')}
                   </h3>
                   <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                     <Mail className="w-3 h-3" />
                     <span>{selectedReply.from_email}</span>
                   </div>
                 </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
                  {selectedReply.subject}
                </h2>
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <div className="p-4 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-gray-100 dark:border-gray-800 whitespace-pre-wrap leading-relaxed text-gray-700 dark:text-gray-300">
                    {selectedReply.body}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 sticky bottom-0 flex justify-end">
              <button
                onClick={() => setSelectedReply(null)}
                className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                {t('repliesView.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const { t } = useTranslation();
  const sentimentConfig = {
    interested: { label: `✨ ${t('repliesView.sentimentInterested')}`, color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' },
    positive: { label: `👍 ${t('repliesView.sentimentPositive')}`, color: 'bg-[#1ED4A7]/10 text-[#1ED4A7] border border-[#1ED4A7]/20' },
    neutral: { label: `💬 ${t('repliesView.sentimentNeutral')}`, color: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400' },
    negative: { label: `👎 ${t('repliesView.sentimentNegative')}`, color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
    unsubscribe: { label: `🚫 ${t('repliesView.sentimentUnsubscribe')}`, color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  };

  const config = sentimentConfig[sentiment.toLowerCase() as keyof typeof sentimentConfig] || sentimentConfig.neutral;

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wide ${config.color}`}>
      {config.label}
    </span>
  );
}