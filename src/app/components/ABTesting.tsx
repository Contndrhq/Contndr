import { useState, useEffect } from 'react';
import { projectId } from '../utils/supabase/info';
import { getAuthHeaders } from '../lib/auth';
import {
  FlaskConical,
  Plus,
  Play,
  Pause,
  Trash2,
  TrendingUp,
  BarChart3,
  Mail,
  MousePointer,
  MessageSquare,
  Target,
  Trophy,
  Zap,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { CreateABTestModal } from './CreateABTestModal';

interface ABTestVariant {
  id: string;
  name: string;
  subjectLine: string;
  emailBody: string;
  ctaText?: string;
  ctaUrl?: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  conversionRate: number;
  confidence: number;
}

interface ABTest {
  id: string;
  campaignId: string;
  name: string;
  description?: string;
  brand: string;
  testType: 'subject' | 'body' | 'cta' | 'full';
  variants: ABTestVariant[];
  sampleSize: number;
  winnerMetric: 'open_rate' | 'click_rate' | 'reply_rate';
  minConfidence: number;
  status: 'draft' | 'running' | 'completed' | 'paused';
  startedAt?: string;
  completedAt?: string;
  winnerId?: string;
  createdAt: string;
  updatedAt: string;
}

interface ABTestStats {
  totalSent: number;
  totalOpened: number;
  totalClicked: number;
  totalReplied: number;
  avgOpenRate: number;
  avgClickRate: number;
  avgReplyRate: number;
  leader: ABTestVariant | null;
  winner: ABTestVariant | null;
}

interface ABTestingProps {
  onNavigateToCampaigns?: () => void;
}

export function ABTesting({ onNavigateToCampaigns }: ABTestingProps = {}) {
  const [tests, setTests] = useState<ABTest[]>([]);
  const [selectedTest, setSelectedTest] = useState<ABTest | null>(null);
  const [testStats, setTestStats] = useState<ABTestStats | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [newTest, setNewTest] = useState({
    campaignId: '',
    name: '',
    description: '',
    brand: '',
    testType: 'subject' as 'subject' | 'body' | 'cta' | 'full',
    variantA: {
      name: 'Variant A',
      subjectLine: '',
      emailBody: '',
    },
    variantB: {
      name: 'Variant B',
      subjectLine: '',
      emailBody: '',
    },
    sampleSize: 100,
    winnerMetric: 'open_rate' as 'open_rate' | 'click_rate' | 'reply_rate',
    minConfidence: 95,
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadTests();
    
    // Auto-refresh every 2 minutes
    const interval = setInterval(() => {
      loadTests();
      if (selectedTest) {
        loadTestStats(selectedTest.id);
      }
    }, 2 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [selectedTest]);

  useEffect(() => {
    if (selectedTest) {
      loadTestStats(selectedTest.id);
    }
  }, [selectedTest]);

  const loadTests = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('Loading A/B tests...');
      
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ab-tests`,
        {
          headers,
        }
      );

      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Response data:', data);
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load tests');
      }

      if (data.success) {
        setTests(data.tests || []);
        if ((data.tests || []).length > 0 && !selectedTest) {
          setSelectedTest(data.tests[0]);
        }
        console.log(`Loaded ${data.tests?.length || 0} A/B tests`);
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error loading A/B tests:', error);
      setError(error.message || 'Failed to load tests');
    } finally {
      setLoading(false);
      setLastRefreshTime(new Date());
    }
  };

  const loadTestStats = async (testId: string) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ab-tests/${testId}/stats`,
        {
          headers,
        }
      );

      const data = await response.json();
      if (data.success) {
        setTestStats(data.stats);
      }
    } catch (error) {
      console.error('Error loading test stats:', error);
    }
  };

  const startTest = async (testId: string) => {
    try {
      const headers = await getAuthHeaders();
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ab-tests/${testId}/start`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({})
        }
      );
      loadTests();
    } catch (error) {
      console.error('Error starting test:', error);
    }
  };

  const pauseTest = async (testId: string) => {
    try {
      const headers = await getAuthHeaders();
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ab-tests/${testId}/pause`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({})
        }
      );
      loadTests();
    } catch (error) {
      console.error('Error pausing test:', error);
    }
  };

  const deleteTest = async (testId: string) => {
    if (!confirm('Are you sure you want to delete this A/B test?')) return;

    try {
      const headers = await getAuthHeaders();
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ab-tests/${testId}`,
        {
          method: 'DELETE',
          headers,
        }
      );
      loadTests();
      if (selectedTest?.id === testId) {
        setSelectedTest(null);
      }
    } catch (error) {
      console.error('Error deleting test:', error);
    }
  };

  const loadCampaigns = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/campaigns`,
        {
          headers,
        }
      );
      const data = await response.json();
      if (data.success) {
        setCampaigns(data.campaigns || []);
      }
    } catch (error) {
      console.error('Error loading campaigns:', error);
    }
  };

  const createTest = async () => {
    if (!newTest.name || !newTest.variantA.subjectLine || !newTest.variantB.subjectLine) {
      alert('Please fill in test name and subject lines for both variants');
      return;
    }

    try {
      setCreating(true);
      
      const testData = {
        campaignId: newTest.campaignId || `standalone-${Date.now()}`, // Generate ID if no campaign selected
        name: newTest.name,
        description: newTest.description,
        brand: newTest.brand,
        testType: newTest.testType,
        variants: [
          {
            name: newTest.variantA.name,
            subjectLine: newTest.variantA.subjectLine,
            emailBody: newTest.variantA.emailBody,
          },
          {
            name: newTest.variantB.name,
            subjectLine: newTest.variantB.subjectLine,
            emailBody: newTest.variantB.emailBody,
          },
        ],
        sampleSize: newTest.sampleSize,
        winnerMetric: newTest.winnerMetric,
        minConfidence: newTest.minConfidence,
      };

      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/ab-tests`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(testData),
        }
      );

      const data = await response.json();
      
      if (data.success) {
        setShowCreateModal(false);
        loadTests();
        // Reset form
        setNewTest({
          campaignId: '',
          name: '',
          description: '',
          brand: '',
          testType: 'subject',
          variantA: {
            name: 'Variant A',
            subjectLine: '',
            emailBody: '',
          },
          variantB: {
            name: 'Variant B',
            subjectLine: '',
            emailBody: '',
          },
          sampleSize: 100,
          winnerMetric: 'open_rate',
          minConfidence: 95,
        });
      } else {
        alert(`Error creating test: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error creating A/B test:', error);
      alert('Failed to create A/B test');
    } finally {
      setCreating(false);
    }
  };

  const handleModalOpen = () => {
    setShowCreateModal(true);
    loadCampaigns();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <span className="px-2 py-1 bg-[#1ED4A7]/10 text-[#1ED4A7] text-xs rounded-full">Running</span>;
      case 'completed':
        return <span className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs rounded-full">Completed</span>;
      case 'paused':
        return <span className="px-2 py-1 bg-zinc-200 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 text-xs rounded-full">Paused</span>;
      default:
        return <span className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs rounded-full">Draft</span>;
    }
  };

  const getMetricIcon = (metric: string) => {
    switch (metric) {
      case 'open_rate':
        return <Mail className="w-4 h-4" />;
      case 'click_rate':
        return <MousePointer className="w-4 h-4" />;
      case 'reply_rate':
        return <MessageSquare className="w-4 h-4" />;
      default:
        return <Target className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1>A/B Testing</h1>
            <div className="group relative">
              <div className="w-1.5 h-1.5 rounded-full bg-[#1ED4A7] animate-pulse" />
              <div className="absolute left-0 top-6 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                <div className="bg-zinc-900 dark:bg-zinc-700 text-white text-xs px-2 py-1 rounded whitespace-nowrap shadow-lg">
                  Auto-refresh • {lastRefreshTime.toLocaleTimeString()}
                </div>
              </div>
            </div>
          </div>
          <p className="mt-1">Test email variations and optimize for maximum conversions</p>
        </div>
        <button
          onClick={handleModalOpen}
          className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2 w-full sm:w-auto flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          New A/B Test
        </button>
      </div>

      {/* Test List */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar - Test List */}
        <div className="lg:col-span-1 space-y-3">
          {loading ? (
            <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 text-center text-zinc-500">
              Loading...
            </div>
          ) : tests.length === 0 ? (
            <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 text-center">
              <FlaskConical className="w-12 h-12 mx-auto mb-3 text-zinc-300" />
              <p className="text-zinc-500 mb-4">No A/B tests yet</p>
              <button
                onClick={handleModalOpen}
                className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg hover:opacity-90 transition-opacity"
              >
                Create First Test
              </button>
            </div>
          ) : (
            tests.map((test) => (
              <div
                key={test.id}
                onClick={() => setSelectedTest(test)}
                className={`bg-white dark:bg-black border rounded-lg p-4 cursor-pointer transition-all ${
                  selectedTest?.id === test.id
                    ? 'border-slate-500 shadow-lg'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-sm">{test.name}</h3>
                  {getStatusBadge(test.status)}
                </div>
                <p className="text-xs text-zinc-500 mb-3">{test.variants.length} variants</p>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  {getMetricIcon(test.winnerMetric)}
                  <span className="capitalize">{test.winnerMetric.replace('_', ' ')}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Main Content - Test Details */}
        <div className="lg:col-span-3">
          {selectedTest ? (
            <div className="space-y-6">
              {/* Test Header */}
              <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-xl font-semibold">{selectedTest.name}</h2>
                      {getStatusBadge(selectedTest.status)}
                    </div>
                    {selectedTest.description && (
                      <p className="text-zinc-600 dark:text-zinc-400">{selectedTest.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {selectedTest.status === 'draft' && (
                      <button
                        onClick={() => startTest(selectedTest.id)}
                        className="px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-2"
                      >
                        <Play className="w-4 h-4" />
                        Start
                      </button>
                    )}
                    {selectedTest.status === 'running' && (
                      <button
                        onClick={() => pauseTest(selectedTest.id)}
                        className="px-4 py-2 bg-zinc-600 text-white rounded-lg hover:bg-zinc-700 transition-colors flex items-center gap-2"
                      >
                        <Pause className="w-4 h-4" />
                        Pause
                      </button>
                    )}
                    <button
                      onClick={() => deleteTest(selectedTest.id)}
                      className="px-4 py-2 bg-zinc-700 dark:bg-zinc-600 text-white rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-500 transition-colors flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
                  <div>
                    <p className="text-sm text-zinc-500 mb-1">Test Type</p>
                    <p className="font-medium capitalize">{selectedTest.testType}</p>
                  </div>
                  <div>
                    <p className="text-sm text-zinc-500 mb-1">Sample Size</p>
                    <p className="font-medium">{selectedTest.sampleSize}</p>
                  </div>
                  <div>
                    <p className="text-sm text-zinc-500 mb-1">Win Metric</p>
                    <p className="font-medium capitalize">{selectedTest.winnerMetric.replace('_', ' ')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-zinc-500 mb-1">Min Confidence</p>
                    <p className="font-medium">{selectedTest.minConfidence}%</p>
                  </div>
                </div>
              </div>

              {/* Overall Stats */}
              {testStats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-zinc-500 mb-1">
                      <Mail className="w-4 h-4" />
                      <span className="text-sm">Total Sent</span>
                    </div>
                    <p className="text-2xl font-semibold">{testStats.totalSent}</p>
                  </div>
                  <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-zinc-500 mb-1">
                      <Mail className="w-4 h-4" />
                      <span className="text-sm">Avg Open Rate</span>
                    </div>
                    <p className="text-2xl font-semibold text-zinc-300 dark:text-zinc-300">
                      {testStats.avgOpenRate.toFixed(1)}%
                    </p>
                  </div>
                  <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-1">
                      <MousePointer className="w-4 h-4" />
                      <span className="text-sm">Avg Click Rate</span>
                    </div>
                    <p className="text-2xl font-semibold text-zinc-300 dark:text-zinc-300">
                      {testStats.avgClickRate.toFixed(1)}%
                    </p>
                  </div>
                  <div className="bg-white dark:bg-black border border-[#1ED4A7]/20 dark:border-[#1ED4A7]/20 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-[#1ED4A7] mb-1">
                      <MessageSquare className="w-4 h-4" />
                      <span className="text-sm">Avg Reply Rate</span>
                    </div>
                    <p className="text-2xl font-semibold text-[#1ED4A7]">
                      {testStats.avgReplyRate.toFixed(1)}%
                    </p>
                  </div>
                </div>
              )}

              {/* Winner Announcement */}
              {selectedTest.winnerId && testStats?.winner && (
                <div className="bg-gradient-to-r from-[#1ED4A7] to-[#1ED4A7]/80 text-white rounded-lg p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <Trophy className="w-6 h-6" />
                    <h3 className="text-lg font-semibold">Winner Determined!</h3>
                  </div>
                  <p className="text-zinc-100 mb-4">
                    <strong>{testStats.winner.name}</strong> is the winning variant with {testStats.winner.confidence}% confidence
                  </p>
                  <div className="grid grid-cols-3 gap-4 bg-white/10 rounded-lg p-4">
                    <div>
                      <p className="text-zinc-200 text-sm mb-1">Open Rate</p>
                      <p className="text-xl font-semibold">{testStats.winner.openRate.toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-zinc-200 text-sm mb-1">Click Rate</p>
                      <p className="text-xl font-semibold">{testStats.winner.clickRate.toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-zinc-200 text-sm mb-1">Reply Rate</p>
                      <p className="text-xl font-semibold">{testStats.winner.replyRate.toFixed(1)}%</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Current Leader */}
              {!selectedTest.winnerId && testStats?.leader && testStats.totalSent > 0 && (
                <div className="bg-gradient-to-r from-zinc-800 to-zinc-900 text-white rounded-lg p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <Zap className="w-6 h-6" />
                    <h3 className="text-lg font-semibold">Current Leader</h3>
                  </div>
                  <p className="text-zinc-300 mb-4">
                    <strong>{testStats.leader.name}</strong> is currently leading
                    {testStats.leader.confidence > 0 && ` with ${testStats.leader.confidence}% confidence`}
                  </p>
                  <div className="grid grid-cols-3 gap-4 bg-white/10 rounded-lg p-4">
                    <div>
                      <p className="text-zinc-400 text-sm mb-1">Open Rate</p>
                      <p className="text-xl font-semibold">{testStats.leader.openRate.toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-zinc-400 text-sm mb-1">Click Rate</p>
                      <p className="text-xl font-semibold">{testStats.leader.clickRate.toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-zinc-400 text-sm mb-1">Reply Rate</p>
                      <p className="text-xl font-semibold">{testStats.leader.replyRate.toFixed(1)}%</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Variants */}
              <div className="space-y-4">
                <h3 className="font-semibold">Variants</h3>
                {selectedTest.variants.map((variant, index) => {
                  const isWinner = selectedTest.winnerId === variant.id;
                  const isLeader = testStats?.leader?.id === variant.id;

                  return (
                    <div
                      key={variant.id}
                      className={`bg-white dark:bg-black border rounded-lg p-6 ${
                        isWinner
                          ? 'border-[#1ED4A7] shadow-lg'
                          : isLeader
                          ? 'border-zinc-500'
                          : 'border-zinc-200 dark:border-zinc-800'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-medium">{variant.name}</h4>
                            {isWinner && (
                              <span className="px-2 py-1 bg-[#1ED4A7]/10 dark:bg-[#1ED4A7]/10 text-[#1ED4A7] text-xs rounded-full flex items-center gap-1">
                                <Trophy className="w-3 h-3" />
                                Winner
                              </span>
                            )}
                            {isLeader && !isWinner && (
                              <span className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs rounded-full flex items-center gap-1">
                                <TrendingUp className="w-3 h-3" />
                                Leading
                              </span>
                            )}
                            {variant.confidence > 0 && (
                              <span className="text-sm text-zinc-500">
                                {variant.confidence}% confidence
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                            <strong>Subject:</strong> {variant.subjectLine}
                          </p>
                        </div>
                      </div>

                      {/* Variant Stats */}
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
                        <div>
                          <p className="text-xs text-zinc-500 mb-1">Sent</p>
                          <p className="font-medium">{variant.sent}</p>
                        </div>
                        <div>
                          <p className="text-xs text-zinc-500 mb-1">Opened</p>
                          <p className="font-medium">{variant.opened}</p>
                        </div>
                        <div>
                          <p className="text-xs text-zinc-500 mb-1">Open Rate</p>
                          <p className="font-medium text-zinc-300">
                            {variant.openRate.toFixed(1)}%
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-zinc-500 mb-1">Clicked</p>
                          <p className="font-medium">{variant.clicked}</p>
                        </div>
                        <div>
                          <p className="text-xs text-zinc-500 mb-1">Click Rate</p>
                          <p className="font-medium text-zinc-400">
                            {variant.clickRate.toFixed(1)}%
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-zinc-500 mb-1">Reply Rate</p>
                          <p className="font-medium text-[#1ED4A7] dark:text-[#1ED4A7]">
                            {variant.replyRate.toFixed(1)}%
                          </p>
                        </div>
                      </div>

                      {/* Email Preview */}
                      <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-4">
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap line-clamp-3">
                          {variant.emailBody}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-lg p-12 text-center">
              <FlaskConical className="w-16 h-16 mx-auto mb-4 text-zinc-300" />
              <p className="text-zinc-500">Select an A/B test to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal Placeholder */}
      {showCreateModal && (
        <CreateABTestModal
          campaigns={campaigns}
          newTest={newTest}
          setNewTest={setNewTest}
          creating={creating}
          onClose={() => setShowCreateModal(false)}
          onCreate={createTest}
          onNavigateToCampaigns={() => {
            setShowCreateModal(false);
            onNavigateToCampaigns?.();
          }}
        />
      )}
    </div>
  );
}