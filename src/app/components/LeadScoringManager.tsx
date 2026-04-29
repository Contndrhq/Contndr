import React, { useState } from 'react';
import { Sparkles, Loader2, TrendingUp, CheckCircle, AlertCircle, BarChart3, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';

interface ScoringStats {
  totalLeads: number;
  scored: number;
  errors: number;
  averageScore: number;
}

export default function LeadScoringManager() {
  const [isScoring, setIsScoring] = useState(false);
  const [scoringStats, setScoringStats] = useState<ScoringStats | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Get access token
  React.useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        setAccessToken(session.access_token);
      }
    };
    getSession();
  }, []);

  const scoreAllLeads = async () => {
    if (!accessToken) {
      toast.error('Not authenticated');
      return;
    }

    const confirmed = confirm(
      '🎯 Score All Leads?\n\n' +
      'This will analyze all your leads and assign quality scores (0-100) based on:\n\n' +
      '• Data completeness\n' +
      '• Contact quality\n' +
      '• Company size & industry\n' +
      '• Job title/decision-making power\n' +
      '• Email engagement history\n' +
      '• Lead recency & status\n\n' +
      'This may take a few moments for large lead lists.\n\n' +
      'Continue?'
    );

    if (!confirmed) return;

    setIsScoring(true);
    setScoringStats(null);

    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/score-all`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setScoringStats(data.stats);
      
      toast.success(
        `✅ Lead scoring complete!\n\n` +
        `${data.stats.scored} leads scored with average score of ${data.stats.averageScore}`,
        { duration: 5000 }
      );

      // Suggest refreshing
      setTimeout(() => {
        if (confirm('Lead scoring is complete! Would you like to refresh the page to see updated scores?')) {
          window.location.reload();
        }
      }, 1500);

    } catch (error) {
      console.error('Scoring error:', error);
      toast.error(`Failed to score leads: ${error.message}`);
    } finally {
      setIsScoring(false);
    }
  };

  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-[#1ED4A7]';
    if (score >= 60) return 'text-zinc-300';
    if (score >= 40) return 'text-zinc-400';
    return 'text-zinc-500';
  };

  const getScoreGrade = (score: number): string => {
    if (score >= 90) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 80) return 'A-';
    if (score >= 75) return 'B+';
    if (score >= 70) return 'B';
    if (score >= 65) return 'B-';
    if (score >= 60) return 'C+';
    if (score >= 55) return 'C';
    if (score >= 50) return 'C-';
    if (score >= 40) return 'D';
    return 'F';
  };

  return (
    <div className="border border-white/10 rounded-xl bg-black/40 backdrop-blur-sm p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-[#1ED4A7]" />
            <h2 className="text-[18px] font-semibold text-white">AI Lead Scoring</h2>
          </div>
          <p className="text-zinc-400 text-[14px]">
            Automatically score your leads based on quality signals, engagement, and potential value
          </p>
        </div>

        <button
          onClick={scoreAllLeads}
          disabled={isScoring}
          className="flex items-center gap-2 px-4 py-2 bg-[#1ED4A7] text-black rounded-lg font-medium hover:bg-[#1ED4A7]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap h-fit"
        >
          {isScoring ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Scoring...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              Score All Leads
            </>
          )}
        </button>
      </div>

      {/* Scoring Factors Explanation */}
      <div className="bg-white/5 rounded-lg p-4 border border-white/10 mb-6">
        <h3 className="text-white font-medium mb-3 text-[14px]">Scoring Factors</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-white font-medium">Data Completeness (10%)</div>
              <div className="text-zinc-400">All fields filled out properly</div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-white font-medium">Contact Quality (15%)</div>
              <div className="text-zinc-400">Business email, phone, website</div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-white font-medium">Company Size (15%)</div>
              <div className="text-zinc-400">Larger companies score higher</div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-white font-medium">Industry Value (10%)</div>
              <div className="text-zinc-400">High-value industries (SaaS, Tech, Finance)</div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-white font-medium">Title Value (15%)</div>
              <div className="text-zinc-400">Decision-makers (CEO, VP, Director)</div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-white font-medium">Engagement (20%)</div>
              <div className="text-zinc-400">Email opens, clicks, and replies</div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-white font-medium">Recency (10%)</div>
              <div className="text-zinc-400">Recently contacted leads score higher</div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-[#1ED4A7] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-white font-medium">Lead Status (5%)</div>
              <div className="text-zinc-400">Pipeline stage (qualified, negotiation, won)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {scoringStats && (
        <div className="bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5 text-[#1ED4A7]" />
            <h3 className="text-white font-medium">Scoring Results</h3>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-zinc-400 text-[12px] mb-1">Total Leads</div>
              <div className="text-white text-[20px] font-bold">{scoringStats.totalLeads}</div>
            </div>

            <div>
              <div className="text-zinc-400 text-[12px] mb-1">Successfully Scored</div>
              <div className="text-[#1ED4A7] text-[20px] font-bold">{scoringStats.scored}</div>
            </div>

            <div>
              <div className="text-zinc-400 text-[12px] mb-1">Average Score</div>
              <div className={`text-[20px] font-bold ${getScoreColor(scoringStats.averageScore)}`}>
                {scoringStats.averageScore}
                <span className="text-[14px] ml-1">({getScoreGrade(scoringStats.averageScore)})</span>
              </div>
            </div>

            {scoringStats.errors > 0 && (
              <div>
                <div className="text-zinc-400 text-[12px] mb-1">Errors</div>
                <div className="text-zinc-500 text-[20px] font-bold">{scoringStats.errors}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Grading Scale */}
      <div className="mt-6 bg-white/5 rounded-lg p-4 border border-white/10">
        <h3 className="text-white font-medium mb-3 text-[14px] flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          Grading Scale
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-[13px]">
          <div>
            <div className="text-[#1ED4A7] font-bold">A+ (90-100)</div>
            <div className="text-zinc-400">Hot leads</div>
          </div>
          <div>
            <div className="text-[#1ED4A7] font-bold">B (70-79)</div>
            <div className="text-zinc-400">Good quality</div>
          </div>
          <div>
            <div className="text-zinc-300 font-bold">C (50-69)</div>
            <div className="text-zinc-400">Average</div>
          </div>
          <div>
            <div className="text-zinc-400 font-bold">D (40-49)</div>
            <div className="text-zinc-400">Needs work</div>
          </div>
          <div>
            <div className="text-zinc-500 font-bold">F (0-39)</div>
            <div className="text-zinc-400">Low quality</div>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="mt-6 border border-zinc-500/30 bg-zinc-500/5 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-zinc-400 flex-shrink-0 mt-0.5" />
          <div className="text-[13px]">
            <p className="text-zinc-300 mb-2">
              <strong>How it works:</strong>
            </p>
            <ul className="space-y-1 text-zinc-300">
              <li>• Scores are calculated automatically based on multiple quality signals</li>
              <li>• Higher scores indicate better-qualified leads worth prioritizing</li>
              <li>• Engagement data is included if you've sent emails to the lead</li>
              <li>• Scores update in real-time as lead data and engagement changes</li>
              <li>• Use scores to sort and filter leads in your CRM</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}