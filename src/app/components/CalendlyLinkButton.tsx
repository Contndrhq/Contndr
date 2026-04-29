import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { ScheduleMeetingModal } from './ScheduleMeetingModal';

interface CalendlyLinkButtonProps {
  lead: {
    id: string;
    business_name: string;
    contact_name?: string;
    email: string;
  };
  campaignId?: string;
  brand?: string;
  variant?: 'button' | 'icon';
  onScheduled?: () => void;
}

export function CalendlyLinkButton({ 
  lead, 
  campaignId, 
  brand, 
  variant = 'button',
  onScheduled 
}: CalendlyLinkButtonProps) {
  const [showModal, setShowModal] = useState(false);

  if (variant === 'icon') {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          title="Schedule Meeting"
        >
          <Calendar className="w-4 h-4" />
        </button>

        {showModal && (
          <ScheduleMeetingModal
            lead={lead}
            campaignId={campaignId}
            brand={brand}
            onClose={() => setShowModal(false)}
            onScheduled={() => {
              setShowModal(false);
              if (onScheduled) onScheduled();
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black text-[13px] rounded-lg transition-colors font-medium"
      >
        <Calendar className="w-4 h-4" />
        Schedule Meeting
      </button>

      {showModal && (
        <ScheduleMeetingModal
          lead={lead}
          campaignId={campaignId}
          brand={brand}
          onClose={() => setShowModal(false)}
          onScheduled={() => {
            setShowModal(false);
            if (onScheduled) onScheduled();
          }}
        />
      )}
    </>
  );
}