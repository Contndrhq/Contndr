import { CheckCircle, Circle, ExternalLink, Database, Key, Mail, Zap, Rocket } from 'lucide-react';
import { useState } from 'react';

export function QuickStart() {
  const [completed, setCompleted] = useState({
    database: false,
    webhook: false,
    testLeads: false,
    testCampaign: false,
  });

  const steps = [
    {
      id: 'database',
      title: 'Set up Database Tables',
      description: 'Run the SQL schema in Supabase to create all required tables',
      icon: Database,
      color: 'blue',
      links: [
        { label: 'Open Schema File', url: '/database-schema.sql' },
        { label: 'Supabase Dashboard', url: 'https://supabase.com/dashboard' },
      ],
    },
    {
      id: 'webhook',
      title: 'Configure Resend Webhook',
      description: 'Set up webhook for real-time email event tracking (opens, clicks, bounces)',
      icon: Mail,
      color: 'emerald',
      links: [
        { label: 'Go to Settings', url: '#', action: 'settings' },
        { label: 'Resend Webhooks', url: 'https://resend.com/webhooks' },
      ],
    },
    {
      id: 'testLeads',
      title: 'Import Test Leads',
      description: 'Try discovering leads automatically with email verification',
      icon: Rocket,
      color: 'sky',
      links: [
        { label: 'Import Leads', url: '#', action: 'leads' },
        { label: 'Setup Guide', url: '/SETUP-COMPLETE.md' },
      ],
    },
    {
      id: 'testCampaign',
      title: 'Create Test Campaign',
      description: 'Generate AI-powered emails and create your first campaign',
      icon: Zap,
      color: 'slate',
      links: [
        { label: 'New Campaign', url: '#', action: 'campaign' },
        { label: 'Features Guide', url: '/FEATURES.md' },
      ],
    },
  ];

  const toggleStep = (stepId: string) => {
    setCompleted(prev => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  const allCompleted = Object.values(completed).every(v => v);
  const completedCount = Object.values(completed).filter(v => v).length;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-gradient-to-br from-slate-500 to-blue-500 rounded-xl flex items-center justify-center shadow-md">
            <Zap className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <h2 className="text-[18px] font-semibold">Quick Start</h2>
            <p className="text-gray-500 text-[13px]">Complete these steps to get operational</p>
          </div>
        </div>
        
        {/* Progress */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-slate-500 to-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${(completedCount / steps.length) * 100}%` }}
            />
          </div>
          <span className="text-[13px] text-gray-700 font-semibold min-w-[3rem] text-right">
            {completedCount}/{steps.length}
          </span>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map((step, index) => {
          const isCompleted = completed[step.id as keyof typeof completed];
          const Icon = step.icon;
          
          const colorClasses = {
            blue: 'from-blue-500 to-blue-600 text-white',
            slate: 'from-slate-500 to-slate-600 text-white',
            sky: 'from-sky-500 to-sky-600 text-white',
            emerald: 'from-emerald-500 to-emerald-600 text-white',
          };
          
          return (
            <div
              key={step.id}
              className={`rounded-xl p-4 border-2 transition-all ${
                isCompleted
                  ? 'bg-gradient-to-br from-gray-50 to-gray-100 border-gray-300'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <button
                  onClick={() => toggleStep(step.id)}
                  className="flex-shrink-0 mt-0.5"
                >
                  {isCompleted ? (
                    <CheckCircle className="w-5 h-5 text-emerald-500" strokeWidth={2.5} />
                  ) : (
                    <Circle className="w-5 h-5 text-gray-300" strokeWidth={2} />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  {/* Title */}
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className={`p-2 bg-gradient-to-br ${colorClasses[step.color as keyof typeof colorClasses]} rounded-lg shadow-md`}>
                      <Icon className="w-4 h-4" strokeWidth={2.5} />
                    </div>
                    <h3 className={`text-[14px] font-medium ${isCompleted ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                      {step.title}
                    </h3>
                  </div>

                  {/* Description */}
                  <p className="text-gray-600 text-[13px] mb-3 ml-11">
                    {step.description}
                  </p>

                  {/* Links */}
                  <div className="flex flex-wrap gap-2 ml-11">
                    {step.links.map(link => (
                      <a
                        key={link.url}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 hover:text-gray-900 hover:border-gray-300 hover:shadow-sm rounded-lg text-[12px] font-medium transition-all"
                      >
                        <span>{link.label}</span>
                        <ExternalLink className="w-3 h-3" strokeWidth={2} />
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Success */}
      {allCompleted && (
        <div className="mt-5 p-5 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-xl animate-scale-in shadow-lg">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-6 h-6" strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-[16px] font-semibold mb-2">Setup Complete</h3>
              <p className="text-white/90 text-[13px] mb-3">
                All configuration steps completed. Your platform is ready to launch.
              </p>
              <div className="grid grid-cols-2 gap-2 text-[13px]">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/80" />
                  <span className="text-white/90">Import leads</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/80" />
                  <span className="text-white/90">Create campaigns</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/80" />
                  <span className="text-white/90">Generate emails</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/80" />
                  <span className="text-white/90">Track analytics</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}