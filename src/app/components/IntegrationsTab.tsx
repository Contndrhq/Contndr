import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  Loader2,
  AlertCircle,
  ExternalLink,
  Unlink,
  RefreshCw,
  Clock,
  ChevronDown,
  ChevronUp,
  XCircle,
  Key,
  CreditCard,
  ArrowUpRight,
  Zap,
  ShieldCheck,
  Hash,
  Bell,
  Send,
  MessageSquare,
  ToggleRight,
  Lock,
  Phone,
  Trash2,
} from 'lucide-react';
import { authenticatedFetch, getAuthHeaders, getAuthToken } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { apiCache, useApiCache } from '../lib/api-cache';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from './LoadingSpinner';
import { OAuthResultModal } from './OAuthResultModal';
import { TelnyxApiKeySetup } from './TelnyxApiKeySetup';
import TelnyxPhoneNumbers from './TelnyxPhoneNumbers';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f`;

// ═══════════════════════════════════════════════════════════════════════
// Brand SVG Logos — Professional / Official Paths
// ═══════════════════════════════════════════════════════════════════════

function StripeLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={`block ${className}`} viewBox="0 0 18 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10.542 9.15C8.37 8.344 7.186 7.724 7.186 6.741C7.186 5.91 7.869 5.436 9.087 5.436C11.314 5.436 13.602 6.294 15.177 7.067L16.067 1.573C14.818 0.975 12.263 0 8.731 0C6.233 0 4.155 0.654 2.67 1.872C1.126 3.147 0.323 4.992 0.323 7.218C0.323 11.257 2.79 12.978 6.799 14.437C9.384 15.357 10.244 16.011 10.244 17.02C10.244 18 9.404 18.565 7.89 18.565C6.015 18.565 2.925 17.644 0.9 16.456L0 22.011C1.741 22.99 4.951 24 8.28 24C10.921 24 13.123 23.376 14.608 22.187C16.272 20.882 17.133 18.951 17.133 16.455C17.133 12.327 14.609 10.604 10.539 9.15H10.542Z" fill="#635BFF"/>
    </svg>
  );
}

function HubSpotLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={`block ${className}`} viewBox="0 0 31 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M23.5121 10.5729V6.7809C24.0149 6.54599 24.4405 6.17299 24.7394 5.70539C25.0382 5.23779 25.198 4.69485 25.2001 4.1399V4.0509C25.198 3.27659 24.8894 2.53459 24.3419 1.98707C23.7944 1.43954 23.0524 1.13101 22.2781 1.1289H22.1891C21.414 1.12996 20.6708 1.43799 20.1223 1.9856C19.5738 2.53321 19.2645 3.27581 19.2621 4.0509V4.1399C19.265 4.6912 19.4235 5.23049 19.7193 5.69574C20.015 6.16099 20.4361 6.53331 20.9341 6.7699L20.9501 6.7799V10.5819C19.4993 10.8021 18.1332 11.4044 16.9921 12.3269L17.0081 12.3169L6.57007 4.1869C7.51307 0.665903 2.91907 -1.5891 0.711073 1.3119C-1.50293 4.2079 1.87807 8.0409 5.02907 6.2079L5.01307 6.2179L15.2731 14.2019C14.3662 15.5639 13.8842 17.1646 13.8881 18.8009C13.8881 20.5869 14.4561 22.2489 15.4191 23.6079L15.4031 23.5819L12.2781 26.7019C12.0281 26.6239 11.7681 26.5819 11.5071 26.5769H11.5021C9.09107 26.5769 7.87707 29.4989 9.58507 31.2069C11.2931 32.9099 14.2151 31.7019 14.2151 29.2899C14.2095 29.019 14.1641 28.7505 14.0801 28.4929L14.0851 28.5139L17.1741 25.4249C18.1818 26.1936 19.3514 26.7226 20.5941 26.9718C21.8368 27.221 23.1199 27.1837 24.3461 26.8629C25.5708 26.5403 26.7058 25.9428 27.6651 25.1158C28.6243 24.2889 29.3825 23.2542 29.882 22.0904C30.3815 20.9266 30.6093 19.6643 30.548 18.3993C30.4866 17.1343 30.1378 15.8999 29.5281 14.7899C28.9183 13.68 28.0632 12.724 27.0279 11.9948C25.9926 11.2655 24.8045 10.7823 23.5541 10.5819L23.5021 10.5719L23.5121 10.5729ZM22.2251 23.0779C18.4181 23.0679 16.5221 18.4629 19.2201 15.7759C21.9131 13.0879 26.5121 14.9949 26.5121 18.8019V18.8069C26.5121 19.3682 26.4014 19.924 26.1865 20.4425C25.9715 20.961 25.6565 21.4321 25.2594 21.8287C24.8622 22.2254 24.3908 22.5399 23.872 22.7542C23.3533 22.9686 22.7974 23.0786 22.2361 23.0779H22.2251Z" fill="#FF7A59"/>
    </svg>
  );
}

function CalendlyLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={`block ${className}`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M19.434 14.262C19.7147 14.2627 19.9907 14.284 20.262 14.326C20.262 14.331 20.257 14.336 20.257 14.34C20.1493 14.6109 20.0219 14.8736 19.876 15.126L18.657 17.232C18.1096 18.1829 17.3212 18.9727 16.3712 19.5217C15.4212 20.0707 14.3432 20.3595 13.246 20.359H10.814C9.71681 20.3587 8.63904 20.0695 7.68903 19.5206C6.73902 18.9717 5.95024 18.1824 5.402 17.232L4.184 15.126C3.63508 14.1756 3.34608 13.0975 3.34608 12C3.34608 10.9025 3.63508 9.82436 4.184 8.874L5.402 6.768C5.94946 5.81692 6.73806 5.02704 7.68825 4.47803C8.63844 3.92902 9.71661 3.6403 10.814 3.641H13.246C14.343 3.64149 15.4206 3.93072 16.3704 4.47962C17.3202 5.02852 18.1088 5.81775 18.657 6.768L19.876 8.874C20.023 9.126 20.147 9.393 20.257 9.66C20.257 9.664 20.262 9.669 20.262 9.674C19.988 9.71617 19.7112 9.73756 19.434 9.738C17.618 9.738 16.933 9.131 16.143 8.432C15.379 7.756 14.432 6.915 12.703 6.915H11.674C10.423 6.915 9.287 7.37 8.474 8.193C7.678 8.998 7.241 10.097 7.241 11.292V12.703C7.241 13.899 7.678 14.998 8.474 15.802C9.287 16.625 10.423 17.08 11.674 17.08H12.708C14.437 17.08 15.384 16.239 16.147 15.563C16.938 14.86 17.618 14.257 19.434 14.262ZM19.439 11.025C19.839 11.025 20.232 10.9883 20.618 10.915C20.616 10.9103 20.6153 10.9057 20.616 10.901C20.5409 10.4843 20.424 10.0762 20.267 9.683C20.9844 9.57057 21.6649 9.28992 22.253 8.864C22.253 8.86 22.248 8.851 22.248 8.846C21.9167 7.76294 21.414 6.73997 20.759 5.816C20.1097 4.90259 19.3235 4.09476 18.428 3.421C16.5755 2.02706 14.3184 1.27633 12 1.283C10.552 1.283 9.145 1.563 7.825 2.124C6.552 2.667 5.402 3.439 4.418 4.423C3.434 5.407 2.657 6.552 2.12 7.83C1.5624 9.15118 1.27606 10.571 1.278 12.005C1.278 13.453 1.559 14.86 2.12 16.179C2.662 17.453 3.434 18.602 4.418 19.586C5.402 20.57 6.547 21.347 7.825 21.885C9.149 22.441 10.552 22.726 12 22.726C14.34 22.726 16.561 21.986 18.428 20.589C19.3246 19.9162 20.1111 19.1078 20.759 18.193C21.4111 17.2673 21.9136 16.2448 22.248 15.163C22.248 15.159 22.253 15.149 22.253 15.145C21.6649 14.7191 20.9844 14.4384 20.267 14.326C20.428 13.931 20.543 13.522 20.616 13.108C20.621 13.099 20.621 13.094 20.621 13.085C21.4902 13.244 22.3121 13.5979 23.025 14.12C23.71 14.625 23.577 15.195 23.471 15.536C21.963 20.437 17.398 24 12 24C5.375 24 0 18.625 0 12C0 5.375 5.37 0 12 0C17.398 0 21.963 3.563 23.471 8.464C23.577 8.805 23.71 9.379 23.025 9.885C22.3129 10.4083 21.4906 10.762 20.621 10.919C20.749 11.635 20.749 12.369 20.621 13.085C20.2313 13.0112 19.8356 12.9744 19.439 12.975C15.255 12.975 15.471 15.798 12.703 15.798H11.674C9.775 15.798 8.524 14.441 8.524 12.703V11.292C8.524 9.554 9.775 8.198 11.674 8.198H12.708C15.476 8.198 15.26 11.021 19.439 11.025Z" fill="#006BFF"/>
    </svg>
  );
}

function SalesforceLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={`block ${className}`} viewBox="0 0 30 21" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.6666 10.0135H10.4315C10.4638 9.77164 10.5871 9.35167 11.0708 9.35167C11.3872 9.35167 11.6319 9.53072 11.6666 10.0135ZM18.0726 9.36292C18.0506 9.36292 17.4112 9.27996 17.4112 10.3003C17.4112 11.3207 18.0501 11.2378 18.0726 11.2378C18.682 11.2378 18.734 10.6031 18.734 10.3003C18.734 9.28043 18.0937 9.36292 18.0726 9.36292ZM6.6716 10.4766C6.62022 10.5169 6.57937 10.569 6.55251 10.6285C6.52566 10.688 6.5136 10.7531 6.51738 10.8183C6.51738 11.0423 6.61488 11.1018 6.6716 11.1487C6.89191 11.3221 7.37801 11.2481 7.6527 11.1932V10.3992C7.40332 10.3491 6.86847 10.3074 6.6716 10.4766ZM30 9.37417C30 13.4791 26.25 16.6106 22.2487 15.7688C21.3876 17.3155 18.9332 19.0849 16.0518 17.72C14.1224 22.2219 7.71317 22.0406 6.02941 17.4777C0.417502 18.5974 -2.35283 10.9922 2.50111 8.13725C0.872192 4.4143 3.56236 0 7.85942 0C8.75302 0.000554939 9.63452 0.206723 10.4357 0.602543C11.2368 0.998364 11.9361 1.57322 12.4794 2.28261C13.4498 1.27957 14.7951 0.651036 16.2834 0.651036C18.2681 0.651036 19.9865 1.75344 20.9146 3.39626C25.2656 1.48956 30 4.71943 30 9.37417ZM5.64597 10.8647C5.64597 10.3135 5.098 10.1536 4.80831 10.0599C4.56127 9.96099 4.17971 9.89538 4.17971 9.64087C4.17971 9.19747 4.97659 9.32871 5.35956 9.5415C5.35956 9.5415 5.4144 9.57478 5.43643 9.51947C5.44768 9.48666 5.54706 9.21106 5.55784 9.17778C5.56204 9.16466 5.56096 9.15042 5.55484 9.13809C5.54871 9.12575 5.53802 9.11628 5.52503 9.11169C4.94706 8.75407 3.61721 8.71282 3.61721 9.70695C3.61721 10.291 4.1558 10.4306 4.45534 10.5117C4.67659 10.5858 5.07268 10.6523 5.07268 10.9195C5.07268 11.107 4.90721 11.2504 4.64284 11.2504C4.32162 11.2499 4.0092 11.1455 3.75221 10.9528C3.73018 10.942 3.68564 10.9195 3.67486 10.9861L3.56236 11.3362C3.54033 11.3802 3.57314 11.3915 3.57314 11.4023C3.65518 11.4679 4.05596 11.7112 4.64284 11.7112C5.26018 11.7112 5.64597 11.3802 5.64597 10.8623V10.8647ZM7.14597 8.8689C6.67113 8.8689 6.27128 9.01748 6.14284 9.11169C6.13771 9.11525 6.13333 9.11979 6.12998 9.12506C6.12663 9.13033 6.12436 9.13621 6.12331 9.14237C6.12226 9.14853 6.12245 9.15483 6.12388 9.16091C6.1253 9.16699 6.12792 9.17273 6.13159 9.17778L6.253 9.50869C6.2563 9.52018 6.26386 9.52998 6.27414 9.53608C6.28442 9.54218 6.29665 9.54412 6.30831 9.5415C6.33878 9.5415 6.62707 9.35402 7.10191 9.35402C7.28941 9.35402 7.43285 9.38729 7.53223 9.46463C7.70098 9.59587 7.67566 9.85319 7.67566 9.96053C7.45113 9.94646 6.77988 9.79929 6.29706 10.1368C6.187 10.2122 6.09777 10.3143 6.03762 10.4334C5.97748 10.5525 5.94837 10.6849 5.953 10.8183C5.953 11.0948 6.02378 11.3057 6.26191 11.4909C6.83566 11.8733 7.96254 11.5846 8.04785 11.5569C8.12192 11.5419 8.21332 11.526 8.21332 11.4688V9.88085C8.2152 9.66477 8.22832 8.86656 7.14551 8.86656L7.14597 8.8689ZM9.32802 7.88555C9.3285 7.87817 9.3274 7.87076 9.32479 7.86383C9.32218 7.8569 9.31812 7.85061 9.31289 7.84537C9.30765 7.84014 9.30136 7.83608 9.29443 7.83347C9.2875 7.83086 9.28009 7.82976 9.2727 7.83025H8.81239C8.80504 7.82983 8.79768 7.83098 8.79081 7.83362C8.78394 7.83626 8.7777 7.84033 8.77252 7.84556C8.76734 7.85079 8.76332 7.85705 8.76074 7.86395C8.75816 7.87084 8.75707 7.87821 8.75755 7.88555V11.5884C8.75707 11.5957 8.75816 11.6031 8.76074 11.61C8.76332 11.6168 8.76734 11.6231 8.77252 11.6283C8.7777 11.6336 8.78394 11.6376 8.79081 11.6403C8.79768 11.6429 8.80504 11.6441 8.81239 11.6437H9.27552C9.28291 11.6441 9.29031 11.643 9.29724 11.6404C9.30417 11.6378 9.31046 11.6338 9.3157 11.6285C9.32094 11.6233 9.32499 11.617 9.3276 11.6101C9.33021 11.6031 9.33131 11.5957 9.33083 11.5884L9.32802 7.88555ZM11.9413 9.24153C11.8429 9.13326 11.623 8.88859 11.114 8.88859C10.9494 8.88859 10.4502 8.89937 10.1436 9.30761C9.84599 9.66524 9.83521 10.1564 9.83521 10.3111C9.83521 10.4574 9.84224 10.9795 10.1661 11.3034C10.2899 11.4398 10.5908 11.6891 11.2354 11.6891C11.7426 11.6891 12.0074 11.579 12.1063 11.5129C12.1283 11.5016 12.1396 11.4796 12.1176 11.4248L12.0074 11.1046C12.0018 11.0925 11.9921 11.0826 11.9801 11.0766C11.9681 11.0707 11.9544 11.069 11.9413 11.0718C11.8199 11.1159 11.6437 11.204 11.2246 11.204C10.408 11.204 10.4347 10.5131 10.4305 10.4213H12.1729C12.1856 10.421 12.1979 10.4165 12.2078 10.4086C12.2177 10.4006 12.2247 10.3896 12.2277 10.3772C12.2141 10.3772 12.3248 9.68821 11.9422 9.24153H11.9413ZM13.6612 11.7112C14.2785 11.7112 14.6648 11.3802 14.6648 10.8623C14.6648 10.3111 14.1163 10.1513 13.8266 10.0575C13.6326 9.97974 13.198 9.89913 13.198 9.63852C13.198 9.46229 13.3523 9.34089 13.5951 9.34089C13.8677 9.34637 14.1355 9.41419 14.3779 9.53916C14.3779 9.53916 14.4332 9.57244 14.4552 9.51713C14.466 9.48432 14.5654 9.20872 14.5762 9.17544C14.5804 9.16232 14.5793 9.14808 14.5732 9.13574C14.567 9.1234 14.5563 9.11394 14.5434 9.10935C14.1726 8.87968 13.7587 8.87781 13.5951 8.87781C13.0326 8.87781 12.636 9.2195 12.636 9.70461C12.636 10.2886 13.1741 10.4283 13.4737 10.5094C13.7601 10.6031 14.091 10.6622 14.091 10.9172C14.091 11.1046 13.926 11.2481 13.6612 11.2481C13.34 11.2474 13.0276 11.143 12.7705 10.9504C12.7639 10.9447 12.7558 10.941 12.7471 10.9397C12.7384 10.9384 12.7295 10.9395 12.7215 10.943C12.7134 10.9464 12.7065 10.9521 12.7015 10.9593C12.6965 10.9665 12.6936 10.975 12.6932 10.9837L12.583 11.3362C12.561 11.3802 12.5938 11.3915 12.5938 11.4023C12.6744 11.4679 13.078 11.7112 13.6621 11.7112H13.6612ZM16.7385 8.9992C16.7385 8.96593 16.7273 8.9439 16.6832 8.9439H16.132C16.132 8.93734 16.176 8.52487 16.3415 8.35942C16.5365 8.1649 16.8927 8.28255 16.904 8.28255C16.9588 8.30458 16.9701 8.28255 16.9809 8.26052L17.1135 7.89633C17.1463 7.85227 17.1135 7.84149 17.1023 7.83025C16.8637 7.7365 16.289 7.69573 15.9557 8.02898C15.6988 8.28583 15.6276 8.68142 15.5807 8.9439H15.1837C15.1694 8.94508 15.1561 8.95131 15.1461 8.96144C15.136 8.97158 15.1299 8.98497 15.1288 8.9992L15.0623 9.36292C15.0623 9.39573 15.0735 9.41776 15.1176 9.41776H15.5034C15.1045 11.6629 15.0932 11.7711 15.0182 12.02C14.9676 12.1897 14.864 12.3434 14.7426 12.3837C14.7384 12.3837 14.5607 12.4625 14.2907 12.3725C14.2907 12.3725 14.2466 12.3505 14.2246 12.4058C14.2134 12.4391 14.1032 12.7254 14.0919 12.7587C14.0807 12.792 14.0919 12.8248 14.114 12.8248C14.3535 12.9185 14.7234 12.9078 14.9521 12.8248C15.2465 12.7179 15.4077 12.455 15.4926 12.2183C15.6215 11.8569 15.6243 11.7594 16.0438 9.41823H16.6171C16.6314 9.41706 16.6448 9.41085 16.6549 9.40072C16.6651 9.39059 16.6713 9.3772 16.6724 9.36292L16.7385 8.9992ZM19.2412 9.74914C19.2149 9.6704 19.0021 8.90031 18.0613 8.90031C17.3465 8.90031 16.9832 9.36902 16.882 9.74914C16.8351 9.88975 16.7329 10.4053 16.882 10.8515C16.8862 10.8656 17.0887 11.7008 18.0613 11.7008C18.7621 11.7008 19.1348 11.2504 19.2412 10.8515C19.3917 10.4011 19.2885 9.88975 19.2412 9.74914ZM21.3693 8.9664C21.135 8.88906 20.5903 8.87734 20.3329 9.21997V9.01045C20.3333 9.0031 20.3322 8.99575 20.3295 8.98888C20.3269 8.98201 20.3228 8.97577 20.3176 8.97059C20.3124 8.9654 20.3061 8.96139 20.2992 8.95881C20.2923 8.95623 20.285 8.95514 20.2776 8.95562H19.837C19.8296 8.95514 19.8223 8.95623 19.8154 8.95881C19.8085 8.96139 19.8022 8.9654 19.797 8.97059C19.7918 8.97577 19.7877 8.98201 19.785 8.98888C19.7824 8.99575 19.7813 9.0031 19.7817 9.01045V11.6015C19.7813 11.6088 19.7824 11.6162 19.785 11.6231C19.7877 11.63 19.7917 11.6363 19.797 11.6415C19.8022 11.6467 19.8084 11.6508 19.8153 11.6534C19.8222 11.656 19.8296 11.6572 19.837 11.6568H20.2889C20.2962 11.6572 20.3036 11.656 20.3105 11.6534C20.3174 11.6508 20.3237 11.6467 20.3289 11.6415C20.3341 11.6363 20.3382 11.63 20.3408 11.6231C20.3434 11.6162 20.3446 11.6088 20.3442 11.6015V10.2999C20.3442 10.1635 20.3465 9.76695 20.5532 9.59446C20.7829 9.3648 21.1157 9.43698 21.1818 9.45104C21.1959 9.45079 21.2096 9.4465 21.2213 9.43869C21.233 9.43088 21.2423 9.41988 21.2479 9.40698C21.3029 9.28487 21.3508 9.15967 21.3914 9.03201C21.396 9.02016 21.3963 9.00706 21.3923 8.99498C21.3883 8.9829 21.3802 8.97262 21.3693 8.96593V8.9664ZM23.5636 11.5021L23.4642 11.1604C23.4422 11.1051 23.3981 11.1271 23.3981 11.1271C23.1998 11.2124 22.9223 11.2157 22.8689 11.2157C22.6514 11.2157 22.064 11.1628 22.064 10.2896C22.064 9.99755 22.1507 9.36339 22.8361 9.36339C23.0191 9.35872 23.2017 9.38487 23.3761 9.44073C23.3761 9.44073 23.4201 9.46276 23.4314 9.40745C23.4754 9.28605 23.5082 9.19794 23.5528 9.05451C23.5636 9.01045 23.5307 8.99967 23.5195 8.99967C22.9762 8.81828 22.4723 8.88109 22.2182 8.99967C22.1437 9.03436 21.4575 9.30387 21.4575 10.2896C21.4575 10.4255 21.4303 11.7008 22.814 11.7008C23.0625 11.7004 23.3089 11.6554 23.5415 11.5682C23.5516 11.5607 23.5591 11.5503 23.5631 11.5384C23.567 11.5265 23.5672 11.5137 23.5636 11.5016V11.5021ZM26.0887 9.64977C26.0512 9.50916 25.837 8.88906 25.0411 8.88906C24.2911 8.88906 23.9386 9.36292 23.8392 9.76039C23.7851 9.93903 23.759 10.125 23.7618 10.3116C23.7618 11.5241 24.645 11.6896 25.1625 11.6896C25.6697 11.6896 25.934 11.5794 26.0334 11.5134C26.0554 11.5021 26.0667 11.4801 26.0447 11.4252L25.934 11.1051C25.9284 11.093 25.9188 11.0831 25.9068 11.0771C25.8947 11.0712 25.8811 11.0695 25.8679 11.0723C25.7465 11.1164 25.5703 11.2045 25.1512 11.2045C24.3347 11.2045 24.3614 10.5136 24.3576 10.4217H26.0995C26.1123 10.4214 26.1246 10.4169 26.1346 10.409C26.1445 10.401 26.1517 10.39 26.1548 10.3777C26.1436 10.3772 26.1989 10.0463 26.0887 9.6493V9.64977ZM24.997 9.35214C24.5128 9.35214 24.3876 9.77398 24.3576 10.014H25.5937C25.5525 9.45526 25.2365 9.35167 24.997 9.35167V9.35214Z" fill="#009EDB"/>
    </svg>
  );
}

function SlackLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={`block ${className}`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.271 0a2.527 2.527 0 0 1-2.521 2.521 2.527 2.527 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.164 0a2.528 2.528 0 0 1 2.521 2.522v6.312z" fill="#2EB67D"/>
      <path d="M15.164 18.956a2.528 2.528 0 0 1 2.521 2.522A2.528 2.528 0 0 1 15.164 24a2.528 2.528 0 0 1-2.521-2.522v-2.522h2.521zm0-1.271a2.527 2.527 0 0 1-2.521-2.521 2.527 2.527 0 0 1 2.521-2.521h6.314A2.528 2.528 0 0 1 24 15.164a2.528 2.528 0 0 1-2.522 2.521h-6.314z" fill="#ECB22E"/>
    </svg>
  );
}

function QuickBooksLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={`block ${className}`} viewBox="0 0 62 62" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M30.77 61.54C47.76 61.54 61.54 47.76 61.54 30.77C61.54 13.78 47.76 0 30.77 0C13.78 0 0 13.78 0 30.77C0 47.76 13.77 61.54 30.77 61.54Z" fill="#2CA01C"/>
      <path d="M20.51 18.8C13.9 18.8 8.54004 24.16 8.54004 30.77C8.54004 37.38 13.89 42.73 20.51 42.73H22.22V38.29H20.51C16.36 38.29 12.99 34.92 12.99 30.77C12.99 26.62 16.36 23.25 20.51 23.25H24.62V46.5C24.62 48.95 26.61 50.94 29.06 50.94V18.8H20.51ZM41.03 42.73C47.64 42.73 53 37.37 53 30.77C53 24.17 47.65 18.81 41.03 18.81H39.32V23.25H41.03C45.18 23.25 48.55 26.62 48.55 30.77C48.55 34.92 45.18 38.29 41.03 38.29H36.92V15.04C36.92 12.59 34.93 10.6 32.48 10.6V42.73H41.03Z" fill="white"/>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

type IntegrationId = 'hubspot' | 'stripe' | 'calendly' | 'salesforce' | 'slack' | 'quickbooks' | 'telnyx';

interface IntegrationMeta {
  id: IntegrationId;
  name: string;
  description: string;
  logo: ReactNode;
  logoBg: string;
  brandColor: string;
  features: string[];
  comingSoon?: boolean;
  planGated?: 'growth' | 'enterprise'; // Only show for this plan and above
}

function TelnyxLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={`block ${className}`} viewBox="0 0 90 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M45.009 0L23.822 37.329H66.178L45.009 0ZM18.534 50.677L0 80H37.068V50.677H18.534ZM52.95 50.677H71.484L90 80H52.95V50.677Z" fill="#31B886"/>
    </svg>
  );
}

const INTEGRATIONS: IntegrationMeta[] = [
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'integrationsView.hubspotDesc',
    logo: <HubSpotLogo className="w-[24px] h-[24px]" />,
    logoBg: 'bg-[#FF7A59]/10',
    brandColor: '#1ED4A7',
    features: ['featContacts', 'featCompanies', 'featDeals', 'featAutoAssociation'],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'integrationsView.stripeDesc',
    logo: <StripeLogo className="w-[24px] h-[24px]" />,
    logoBg: 'bg-[#635BFF]/10',
    brandColor: '#1ED4A7',
    features: ['featRevenueTracking', 'featSubscriptions', 'featPayments'],
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    description: 'integrationsView.quickbooksDesc',
    logo: <QuickBooksLogo className="w-[24px] h-[24px]" />,
    logoBg: 'bg-[#2CA01C]/10',
    brandColor: '#1ED4A7',
    features: ['featInvoices', 'featCustomers', 'featPayments', 'featOAuth'],
  },
  {
    id: 'calendly',
    name: 'Calendly',
    description: 'integrationsView.calendlyDesc',
    logo: <CalendlyLogo className="w-[24px] h-[24px]" />,
    logoBg: 'bg-[#006BFF]/10',
    brandColor: '#1ED4A7',
    features: ['featMeetingScheduling', 'featEventTypes', 'featBookingLinks'],
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    description: 'integrationsView.salesforceDesc',
    logo: <SalesforceLogo className="w-[24px] h-[24px]" />,
    logoBg: 'bg-[#00A1E0]/10',
    brandColor: '#1ED4A7',
    features: ['featLeads', 'featContacts', 'featAccounts', 'featOAuth'],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'integrationsView.slackDesc',
    logo: <SlackLogo className="w-[24px] h-[24px]" />,
    logoBg: 'bg-[#4A154B]/10',
    brandColor: '#1ED4A7',
    features: ['featNotifications', 'featChannelPicker', 'featEventToggles', 'featOAuth'],
  },
  {
    id: 'telnyx',
    name: 'Telnyx',
    description: 'integrationsView.telnyxDesc',
    logo: <TelnyxLogo className="w-[24px] h-[24px]" />,
    logoBg: 'bg-[#28D590]/10',
    brandColor: '#1ED4A7',
    features: ['featAICalls', 'featPhoneNumbers', 'featCallRecording', 'featApiKey'],
    planGated: 'growth',
  },
];

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════

// Admin UIDs
const ADMIN_UIDS_INT = ['004b2df9-3e3f-48ec-acfd-5374ab55b09f'];

export function IntegrationsTab() {
  const { t } = useTranslation();
  const [activeIntegration, setActiveIntegration] = useState<IntegrationId | null>(null);
  const [statuses, setStatuses] = useState<Record<IntegrationId, boolean>>({
    hubspot: false,
    stripe: false,
    calendly: false,
    salesforce: false,
    slack: false,
    quickbooks: false,
    telnyx: false,
  });
  const [loadingStatuses, setLoadingStatuses] = useState(true);

  // Fetch billing to determine plan for gating
  const { data: billingData } = useApiCache<any>(
    'billing:details',
    async () => {
      const res = await authenticatedFetch(`${API_BASE}/billing/details`);
      if (!res.ok) return { plan: 'none' };
      return res.json();
    },
    { staleTime: 60_000, cacheTime: 300_000 }
  );
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email?.toLowerCase().trim();
      setIsAdmin(
        email === 'admin@contndr.com' || email === 'or@roadr.com' || email === 'or@contndr.com' ||
        ADMIN_UIDS_INT.includes(session?.user?.id || '')
      );
    })();
  }, []);

  const userPlan = billingData?.plan?.toLowerCase() || 'none';
  const planLevel: Record<string, number> = { none: 0, waitlist: 0, growth: 1, scale: 2, enterprise: 3 };
  const userPlanLevel = planLevel[userPlan] ?? 0;

  function hasPlanAccess(gatedPlan?: string): boolean {
    if (isAdmin) return true;
    if (!gatedPlan) return true;
    const requiredLevel = planLevel[gatedPlan] ?? 0;
    return userPlanLevel >= requiredLevel;
  }

  // Load connection statuses for all integrations
  useEffect(() => {
    loadAllStatuses();

    // Re-check when an integration is connected/disconnected
    const handler = () => loadAllStatuses();
    window.addEventListener('integration-connected', handler);
    return () => window.removeEventListener('integration-connected', handler);
  }, []);

  async function loadAllStatuses() {
    setLoadingStatuses(true);
    try {
      const [hubspot, stripe, calendly, salesforce, slack, quickbooks, telnyx] = await Promise.allSettled([
        checkHubSpotStatus(),
        checkStripeStatus(),
        checkCalendlyStatus(),
        checkSalesforceStatus(),
        checkSlackStatus(),
        checkQuickBooksStatus(),
        checkTelnyxStatus(),
      ]);
      setStatuses({
        hubspot: hubspot.status === 'fulfilled' ? hubspot.value : false,
        stripe: stripe.status === 'fulfilled' ? stripe.value : false,
        calendly: calendly.status === 'fulfilled' ? calendly.value : false,
        salesforce: salesforce.status === 'fulfilled' ? salesforce.value : false,
        slack: slack.status === 'fulfilled' ? slack.value : false,
        quickbooks: quickbooks.status === 'fulfilled' ? quickbooks.value : false,
        telnyx: telnyx.status === 'fulfilled' ? telnyx.value : false,
      });
    } catch (err) {
      console.error('[INTEGRATIONS] Error loading statuses:', err);
    } finally {
      setLoadingStatuses(false);
    }
  }

  async function checkHubSpotStatus(): Promise<boolean> {
    try {
      const data = await apiCache.fetch(
        'hubspot:status',
        async () => {
          const res = await authenticatedFetch(`${API_BASE}/hubspot/status`);
          return res.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );
      return !!data?.connected;
    } catch {
      return false;
    }
  }

  async function checkStripeStatus(): Promise<boolean> {
    try {
      const data = await apiCache.fetch(
        'settings:stripe-config',
        async () => {
          const res = await authenticatedFetch(`${API_BASE}/settings/stripe-config`);
          return res.json();
        },
        { staleTime: 60_000, cacheTime: 300_000 }
      );
      return data?.success && data?.configured;
    } catch {
      return false;
    }
  }

  async function checkCalendlyStatus(): Promise<boolean> {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return false;
      const res = await fetch(`${API_BASE}/calendly/user`, { headers });
      if (!res.ok) return false;
      const data = await res.json();
      // If we get user data back, we're connected
      return !!data?.name || !!data?.email;
    } catch {
      return false;
    }
  }

  async function checkSalesforceStatus(): Promise<boolean> {
    try {
      const data = await apiCache.fetch(
        'salesforce:status',
        async () => {
          const headers = await getAuthHeaders();
          if (!headers.Authorization) return { connected: false };
          const res = await fetch(`${API_BASE}/salesforce/status`, { headers });
          return res.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );
      return !!data?.connected;
    } catch {
      return false;
    }
  }

  async function checkSlackStatus(): Promise<boolean> {
    try {
      const data = await apiCache.fetch(
        'slack:status',
        async () => {
          const headers = await getAuthHeaders();
          if (!headers.Authorization) return { connected: false };
          const res = await fetch(`${API_BASE}/slack/status`, { headers });
          return res.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );
      return !!data?.connected;
    } catch {
      return false;
    }
  }

  async function checkQuickBooksStatus(): Promise<boolean> {
    try {
      const data = await apiCache.fetch(
        'quickbooks:status',
        async () => {
          const headers = await getAuthHeaders();
          if (!headers.Authorization) return { connected: false };
          const res = await fetch(`${API_BASE}/quickbooks/status`, { headers });
          return res.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );
      return !!data?.connected;
    } catch {
      return false;
    }
  }

  async function checkTelnyxStatus(): Promise<boolean> {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return false;
      const res = await fetch(`${API_BASE}/telnyx/config`, { headers });
      if (!res.ok) return false;
      const data = await res.json();
      return !!data?.config?.api_key_configured && data?.config?.account_status === 'active';
    } catch {
      return false;
    }
  }

  function handleBack() {
    loadAllStatuses();
    setActiveIntegration(null);
  }

  // ── Detail views ──
  if (activeIntegration === 'hubspot') {
    return (
      <div className="space-y-4">
        <BackButton onClick={handleBack} label="HubSpot" />
        <HubSpotDetail onStatusChange={() => { loadAllStatuses(); }} />
      </div>
    );
  }

  if (activeIntegration === 'stripe') {
    return (
      <div className="space-y-4">
        <BackButton onClick={handleBack} label="Stripe" />
        <StripeDetail onStatusChange={() => { loadAllStatuses(); }} />
      </div>
    );
  }

  if (activeIntegration === 'calendly') {
    return (
      <div className="space-y-4">
        <BackButton onClick={handleBack} label="Calendly" />
        <CalendlyDetail onStatusChange={() => { loadAllStatuses(); }} />
      </div>
    );
  }

  if (activeIntegration === 'salesforce') {
    return (
      <div className="space-y-4">
        <BackButton onClick={handleBack} label="Salesforce" />
        <SalesforceDetail onStatusChange={() => { loadAllStatuses(); }} />
      </div>
    );
  }

  if (activeIntegration === 'slack') {
    return (
      <div className="space-y-4">
        <BackButton onClick={handleBack} label="Slack" />
        <SlackDetail onStatusChange={() => { loadAllStatuses(); }} />
      </div>
    );
  }

  if (activeIntegration === 'quickbooks') {
    return (
      <div className="space-y-4">
        <BackButton onClick={handleBack} label="QuickBooks" />
        <QuickBooksDetail onStatusChange={() => { loadAllStatuses(); }} />
      </div>
    );
  }

  if (activeIntegration === 'telnyx') {
    return (
      <div className="space-y-4">
        <BackButton onClick={handleBack} label="Telnyx" />
        <TelnyxDetail onStatusChange={() => { loadAllStatuses(); }} />
      </div>
    );
  }

  // ── Overview grid ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-white">{t('integrationsView.title')}</h2>
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
          {t('integrationsView.description')}
        </p>
      </div>

      {/* Cards grid */}
      {loadingStatuses ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {INTEGRATIONS.map((integration) => {
            const connected = statuses[integration.id];
            const disabled = !!integration.comingSoon;
            const locked = integration.planGated && !hasPlanAccess(integration.planGated);
            return (
              <button
                key={integration.id}
                disabled={disabled || locked}
                onClick={() => !disabled && !locked && setActiveIntegration(integration.id)}
                className={`group relative text-left rounded-xl border-2 p-5 transition-all ${
                  locked
                    ? 'border-zinc-100 dark:border-white/5 opacity-70 cursor-default'
                    : disabled
                    ? 'border-zinc-100 dark:border-white/5 opacity-60 cursor-default'
                    : connected
                    ? 'border-[#1ED4A7]/40 hover:border-[#1ED4A7]/60 bg-[#1ED4A7]/[0.03] cursor-pointer'
                    : 'border-zinc-200 dark:border-white/8 hover:border-zinc-300 dark:hover:border-white/15 cursor-pointer'
                }`}
              >
                {/* Top row: logo + status */}
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 rounded-lg ${integration.logoBg} flex items-center justify-center ${locked ? 'opacity-50' : ''}`}>
                    {integration.logo}
                  </div>
                  {locked ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-500/10 text-amber-500">
                      <Lock className="w-2.5 h-2.5" />
                      {integration.planGated === 'growth' ? 'Growth' : 'Enterprise'}
                    </span>
                  ) : disabled ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                      {t('integrationsView.soon')}
                    </span>
                  ) : connected ? (
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#1ED4A7]/10 text-[#1ED4A7]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#1ED4A7] animate-pulse" />
                      {t('integrationsView.connected')}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                      {t('integrationsView.notConnected')}
                    </span>
                  )}
                </div>

                {/* Name + desc */}
                <h3 className={`text-[14px] font-semibold mb-1 ${locked ? 'text-zinc-500 dark:text-zinc-500' : 'text-zinc-900 dark:text-white'}`}>
                  {integration.name}
                </h3>
                <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed mb-3">
                  {t(integration.description)}
                </p>

                {/* Feature pills */}
                <div className="flex flex-wrap gap-1.5">
                  {integration.features.map((f) => (
                    <span
                      key={f}
                      className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400"
                    >
                      {t(`integrationsView.${f}`)}
                    </span>
                  ))}
                </div>

                {/* Hover indicator */}
                {!disabled && !locked && (
                  <div className="absolute bottom-5 right-5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                      {connected ? t('integrationsView.configure') : t('integrationsView.connect')} &rarr;
                    </span>
                  </div>
                )}

                {/* Locked upgrade hint */}
                {locked && (
                  <div className="absolute bottom-5 right-5">
                    <span className="text-[10px] font-medium text-amber-500/70">
                      {t('integrationsView.upgradeToUnlock')}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════���═══════════════════════════
// Shared Back Button
// ═══════════════════════════════════════════════════════════════════════

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors -ml-0.5"
    >
      <ChevronLeft className="w-4 h-4" />
      <span>{t('integrationsView.integrations')}</span>
      <span className="text-zinc-300 dark:text-zinc-600">/</span>
      <span className="text-zinc-900 dark:text-white">{label}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HubSpot Detail (refactored from HubSpotSettings)
// ═══════════════════════════════════════════════════════════════════════

function HubSpotDetail({ onStatusChange }: { onStatusChange: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [oauthModal, setOauthModal] = useState<{ type: 'success' | 'error'; detail?: string; error?: string } | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiCache.fetch(
        'hubspot:status',
        async () => {
          const res = await authenticatedFetch(`${API_BASE}/hubspot/status`);
          return res.json();
        },
        { staleTime: 30_000, cacheTime: 120_000 }
      );
      setStatus(data);
    } catch (err: any) {
      setStatus({ connected: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();

    // Handle redirect-based OAuth return (popup was blocked, SPA callback set localStorage)
    try {
      const hsSuccess = localStorage.getItem('contndr-hubspot-oauth-success');
      const hsError = localStorage.getItem('contndr-hubspot-oauth-error');
      if (hsSuccess) {
        localStorage.removeItem('contndr-hubspot-oauth-success');
        apiCache.invalidate('hubspot:status');
        checkStatus();
        setConnecting(false);
        onStatusChange();
        setOauthModal({ type: 'success' });
      }
      if (hsError) {
        localStorage.removeItem('contndr-hubspot-oauth-error');
        setConnecting(false);
        setOauthModal({ type: 'error', error: hsError || 'HubSpot connection failed' });
      }
    } catch (_) {}

    const handleHubSpotResult = (data: any) => {
      if (data?.type === 'hubspot-oauth-success') {
        apiCache.invalidate('hubspot:status');
        checkStatus();
        setConnecting(false);
        onStatusChange();
        setOauthModal({ type: 'success', detail: data.portal_id ? `Portal ${data.portal_id}` : undefined });
      } else if (data?.type === 'hubspot-oauth-error') {
        setConnecting(false);
        setOauthModal({ type: 'error', error: data.message || 'HubSpot connection failed' });
      }
    };

    // BroadcastChannel (works even when COOP severs window.opener)
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('contndr-oauth-result');
      bc.onmessage = (event) => handleHubSpotResult(event.data);
    } catch (_) {}

    const handleMessage = (event: MessageEvent) => handleHubSpotResult(event.data);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      try { bc?.close(); } catch (_) {}
    };
  }, [checkStatus, onStatusChange]);

  async function handleConnect() {
    try {
      setConnecting(true);
      const res = await authenticatedFetch(`${API_BASE}/hubspot/connect?origin=${encodeURIComponent(window.location.origin)}`);
      const data = await res.json();
      if (data.auth_url) {
        const w = 600, h = 700;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top = window.screenY + (window.outerHeight - h) / 2;
        const popup = window.open(data.auth_url, 'hubspot-oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`);
        if (!popup || popup.closed) { window.open(data.auth_url, '_blank'); return; }
        const poll = setInterval(() => {
          if (popup.closed) {
            clearInterval(poll);
            setTimeout(() => { apiCache.invalidate('hubspot:status'); checkStatus(); setConnecting(false); onStatusChange(); }, 1500);
          }
        }, 1000);
        setTimeout(() => { clearInterval(poll); setConnecting(false); }, 5 * 60 * 1000);
      } else {
        throw new Error(data.error || 'Failed to get authorization URL');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to start HubSpot connection');
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t('integrationsView.disconnectConfirm'))) return;
    try {
      setDisconnecting(true);
      const res = await authenticatedFetch(`${API_BASE}/hubspot/disconnect`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        apiCache.invalidate('hubspot:status');
        setStatus({ connected: false });
        onStatusChange();
        toast.success(t('integrationsView.hubspotDisconnected'));
      } else {
        throw new Error(data.error || 'Failed to disconnect');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  async function loadLogs() {
    setLogsLoading(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/hubspot/export-logs`);
      const data = await res.json();
      setLogs(data.logs || []);
    } catch { /* ignore */ } finally {
      setLogsLoading(false);
    }
  }

  if (loading) return <LoadingSpinner center size="md" />;

  return (
    <div className="space-y-4">
      {/* Connected state */}
      {status?.connected ? (
        <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#FF7A59]/10 flex items-center justify-center">
                <HubSpotLogo className="w-[22px] h-[22px]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">{t('integrationsView.hubspotConnected')}</h3>
                  <span className="w-2 h-2 rounded-full bg-[#1ED4A7] animate-pulse" />
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {status.portal_id && (
                    <span className="text-[12px] text-zinc-500">{t('integrationsView.portal')}: <span className="font-medium text-zinc-700 dark:text-zinc-300">{status.portal_id}</span></span>
                  )}
                  {status.user && (
                    <span className="text-[12px] text-zinc-500">{status.user}</span>
                  )}
                  {status.connected_at && (
                    <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(status.connected_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-all"
            >
              {disconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
              {t('integrationsView.disconnect')}
            </button>
          </div>

          {/* Permissions */}
          {status.scopes?.length > 0 && (
            <div className="text-[11px] text-zinc-400 mb-4">
              <span className="font-medium text-zinc-500">{t('integrationsView.permissions')}:</span>{' '}
              {status.scopes.map((s: string) => s.replace('crm.objects.', '').replace('.', ' ')).join(', ')}
            </div>
          )}

          {/* How to use */}
          <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-lg p-4">
            <h4 className="text-[13px] font-medium text-zinc-900 dark:text-white mb-2">{t('integrationsView.howToExportLeads')}</h4>
            <ul className="text-[12px] text-zinc-500 dark:text-zinc-400 space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">1</span>
                {t('integrationsView.exportStep1')}
              </li>
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">2</span>
                {t('integrationsView.exportStep2Click')} <span className="font-medium text-[#FF7A59]">{t('integrationsView.exportStep2Button')}</span> {t('integrationsView.exportStep2End')}
              </li>
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">3</span>
                {t('integrationsView.exportStep3')}
              </li>
            </ul>
          </div>
        </div>
      ) : (
        /* Disconnected state */
        <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[#FF7A59]/10 flex items-center justify-center">
              <HubSpotLogo className="w-[22px] h-[22px]" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">{t('integrationsView.connectHubSpot')}</h3>
              <p className="text-[12px] text-zinc-500 mt-0.5">
                {t('integrationsView.pushLeadsToHubSpot')}
              </p>
            </div>
          </div>

          {status?.error && (
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-[12px] text-zinc-300 flex items-center gap-2 mb-4">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {status.error}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 mb-4">
            {['featContacts', 'featCompanies', 'featDeals', 'featDedupCheck', 'featAutoAssociation'].map(f => (
              <span key={f} className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400">{t(`integrationsView.${f}`)}</span>
            ))}
          </div>

          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 shadow-sm"
          >
            {connecting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {t('integrationsView.connecting')}</>
            ) : (
              <><ArrowUpRight className="w-4 h-4" /> {t('integrationsView.connectHubSpot')}</>
            )}
          </button>
        </div>
      )}

      {/* Export Activity Log */}
      <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 overflow-hidden">
        <button
          onClick={() => { if (!showLogs && logs.length === 0) loadLogs(); setShowLogs(!showLogs); }}
          className="w-full flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
        >
          <span className="text-[13px] font-medium text-zinc-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-400" />
            {t('integrationsView.exportActivityLog')}
          </span>
          {showLogs ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
        </button>
        {showLogs && (
          <div className="border-t border-zinc-100 dark:border-zinc-800">
            {logsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-[13px] text-zinc-500">{t('integrationsView.noExportActivityYet')}</div>
            ) : (
              <div className="max-h-56 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                {logs.slice(0, 50).map((log: any, i: number) => (
                  <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-[12px]">
                    {log.success ? <CheckCircle2 className="w-3.5 h-3.5 text-[#1ED4A7] shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-zinc-500 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300 capitalize">{log.type?.replace(/_/g, ' ')}</span>
                      {log.action && <span className="text-zinc-500 ml-1">({log.action})</span>}
                      {log.email && <span className="text-zinc-400 ml-1 truncate block">{log.email}</span>}
                      {log.error && <span className="text-zinc-500 ml-1 truncate block">{log.error}</span>}
                    </div>
                    <span className="text-zinc-400 whitespace-nowrap shrink-0">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {oauthModal && (
        <OAuthResultModal
          type={oauthModal.type}
          integrationName="HubSpot"
          detail={oauthModal.detail}
          errorMessage={oauthModal.error}
          logo={<HubSpotLogo className="w-8 h-8" />}
          accentColor="#FF7A59"
          onClose={() => setOauthModal(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════��═══════════════════════
// Stripe Detail
// ═══════════════════════════════════════════════════════════════════════

function StripeDetail({ onStatusChange }: { onStatusChange: () => void }) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { checkConfig(); }, []);

  async function checkConfig() {
    setLoading(true);
    try {
      const data = await apiCache.fetch(
        'settings:stripe-config',
        async () => {
          const res = await authenticatedFetch(`${API_BASE}/settings/stripe-config`);
          return res.json();
        },
        { staleTime: 60_000, cacheTime: 300_000 }
      );
      if (data.success) setConfigured(data.configured);
    } catch (err) {
      console.error('Error checking stripe config:', err);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authenticatedFetch(`${API_BASE}/settings/stripe-config`, {
        method: 'POST',
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        apiCache.invalidate('settings:stripe-config');
        setConfigured(true);
        setApiKey('');
        onStatusChange();
        toast.success(t('integrationsView.stripeConnectedSuccess'));
      } else {
        setError(data.error || 'Failed to save configuration');
      }
    } catch (err) {
      setError('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingSpinner center size="md" />;

  return (
    <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-[#635BFF]/10 flex items-center justify-center">
          <StripeLogo className="w-[22px] h-[22px]" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">
              {configured ? t('integrationsView.stripeConnected') : t('integrationsView.connectStripe')}
            </h3>
            {configured && <span className="w-2 h-2 rounded-full bg-[#1ED4A7] animate-pulse" />}
          </div>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            {t('integrationsView.stripeDetailDesc')}
          </p>
        </div>
      </div>

      {configured ? (
        <div className="space-y-4">
          <div className="bg-[#1ED4A7]/5 border border-[#1ED4A7]/15 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-[#1ED4A7]" />
            <div className="flex-1">
              <p className="text-[13px] font-medium text-zinc-900 dark:text-white">{t('integrationsView.revenueSyncActive')}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">{t('integrationsView.stripeSyncingAuto')}</p>
            </div>
            <button
              onClick={() => setConfigured(false)}
              className="text-[12px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline hover:no-underline"
            >
              {t('integrationsView.updateKey')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 max-w-lg">
          {error && (
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-[12px] text-zinc-300 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}
          <div>
            <label className="block text-[12px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">{t('integrationsView.stripeSecretKey')}</label>
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk_live_..."
                className="w-full px-3 py-2.5 pl-9 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-black text-zinc-900 dark:text-white rounded-lg placeholder-zinc-400"
              />
              <Key className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-3" />
            </div>
            <p className="text-[11px] text-zinc-400 mt-1.5">
              {t('integrationsView.stripeFindKey')}{' '}
              <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer" className="text-zinc-600 dark:text-zinc-300 underline hover:no-underline font-medium">
                {t('integrationsView.stripeDashboard')}
              </a>{' '}
              {t('integrationsView.stripeKeyLocation')}
            </p>
          </div>
          <button
            onClick={saveConfig}
            disabled={saving || !apiKey}
            className="w-full py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 shadow-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('integrationsView.connectStripe')}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Calendly Detail
// ═══════════════════════════════════════════════════════════════════════

function CalendlyDetail({ onStatusChange }: { onStatusChange: () => void }) {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [schedulingUrl, setSchedulingUrl] = useState('');
  const [eventTypes, setEventTypes] = useState<any[]>([]);

  useEffect(() => { fetchStatus(); }, []);

  async function fetchStatus() {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) { setLoading(false); return; }

      // Check if Calendly is connected by fetching user info
      const userRes = await fetch(`${API_BASE}/calendly/user`, { headers });
      if (userRes.status === 404 || userRes.status === 401 || !userRes.ok) {
        setLoading(false);
        return;
      }
      const userData = await userRes.json();
      if (userData?.name || userData?.email) {
        setConnected(true);
        setUserName(userData.name || '');
        setUserEmail(userData.email || '');
        setSchedulingUrl(userData.schedulingUrl || '');

        // Fetch event types
        try {
          const etRes = await fetch(`${API_BASE}/calendly/event-types`, { headers });
          if (etRes.ok) {
            const etData = await etRes.json();
            setEventTypes(etData.eventTypes || []);
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error('[CALENDLY] Status error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    if (!apiKey.trim()) { setError(t('integrationsView.calendlyEnterKey')); return; }
    setSaving(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/calendly/config`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to connect');
        return;
      }
      // Re-fetch status to populate user info
      setApiKey('');
      await fetchStatus();
      onStatusChange();
      toast.success(t('integrationsView.calendlyConnectedSuccess'));
    } catch (err: any) {
      setError(err.message || 'Connection failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t('integrationsView.disconnectCalendlyConfirm'))) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API_BASE}/calendly/disconnect`, { method: 'POST', headers });
      setConnected(false);
      setUserName('');
      setUserEmail('');
      setSchedulingUrl('');
      setEventTypes([]);
      onStatusChange();
      toast.success(t('integrationsView.calendlyDisconnected'));
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (loading) return <LoadingSpinner center size="md" />;

  return (
    <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-[#006BFF]/10 flex items-center justify-center">
          <CalendlyLogo className="w-[22px] h-[22px]" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">
              {connected ? t('integrationsView.calendlyConnected') : t('integrationsView.connectCalendly')}
            </h3>
            {connected && <span className="w-2 h-2 rounded-full bg-[#1ED4A7] animate-pulse" />}
          </div>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            {t('integrationsView.calendlyDetailDesc')}
          </p>
        </div>
        {connected && (
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-all"
          >
            <Unlink className="w-3 h-3" />
            {t('integrationsView.disconnect')}
          </button>
        )}
      </div>

      {connected ? (
        <div className="space-y-4">
          <div className="bg-[#1ED4A7]/5 border border-[#1ED4A7]/15 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#1ED4A7] shrink-0" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-zinc-900 dark:text-white">{userName || t('integrationsView.connected')}</p>
                {userEmail && <p className="text-[11px] text-zinc-500 truncate">{userEmail}</p>}
              </div>
              {schedulingUrl && (
                <a href={schedulingUrl} target="_blank" rel="noreferrer" className="ml-auto text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex items-center gap-1">
                  {t('integrationsView.bookingPage')} <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>

          {eventTypes.length > 0 && (
            <div>
              <h4 className="text-[12px] font-medium text-zinc-500 mb-2">{t('integrationsView.eventTypes')}</h4>
              <div className="space-y-1.5">
                {eventTypes.filter((e: any) => e.active !== false).slice(0, 5).map((et: any, i: number) => (
                  <div key={et.uri || i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: et.color || '#006BFF' }} />
                    <span className="text-[12px] text-zinc-700 dark:text-zinc-300 font-medium flex-1 truncate">{et.name}</span>
                    {et.duration && <span className="text-[11px] text-zinc-400">{et.duration} min</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4 max-w-lg">
          {error && (
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-[12px] text-zinc-300 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}
          <div>
            <label className="block text-[12px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">{t('integrationsView.calendlyToken')}</label>
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="eyJraWQ..."
                className="w-full px-3 py-2.5 pl-9 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-black text-zinc-900 dark:text-white rounded-lg placeholder-zinc-400"
              />
              <Key className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-3" />
            </div>
            <p className="text-[11px] text-zinc-400 mt-1.5">
              {t('integrationsView.calendlyGetToken')}{' '}
              <a href="https://calendly.com/integrations/api_webhooks" target="_blank" rel="noreferrer" className="text-zinc-600 dark:text-zinc-300 underline hover:no-underline font-medium">
                calendly.com/integrations
              </a>
            </p>
          </div>
          <button
            onClick={handleConnect}
            disabled={saving || !apiKey}
            className="w-full py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 shadow-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('integrationsView.connectCalendly')}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Salesforce Detail
// ═══════════════════════════════════════════════════════════════════════

function SalesforceDetail({ onStatusChange }: { onStatusChange: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [oauthModal, setOauthModal] = useState<{ type: 'success' | 'error'; detail?: string; error?: string } | null>(null);
  

  const checkStatus = useCallback(async () => {
    try {
      setLoading(true);
      apiCache.invalidate('salesforce:status');
      const headers = await getAuthHeaders();
      if (!headers.Authorization) { setLoading(false); return; }
      const res = await fetch(`${API_BASE}/salesforce/status`, { headers });
      const data = await res.json();
      setStatus(data);
    } catch (err: any) {
      setStatus({ connected: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();

    // Handle redirect-based OAuth return (popup was blocked)
    try {
      const sfSuccess = localStorage.getItem('contndr-salesforce-oauth-success');
      const sfError = localStorage.getItem('contndr-salesforce-oauth-error');
      if (sfSuccess) {
        localStorage.removeItem('contndr-salesforce-oauth-success');
        apiCache.invalidate('salesforce:status');
        checkStatus();
        setConnecting(false);
        onStatusChange();
        setOauthModal({ type: 'success' });
      }
      if (sfError) {
        localStorage.removeItem('contndr-salesforce-oauth-error');
        setConnecting(false);
        setOauthModal({ type: 'error', error: sfError || 'Salesforce connection failed' });
      }
    } catch (_) {}

    const handleSalesforceResult = (data: any) => {
      if (data?.type === 'salesforce-oauth-success') {
        apiCache.invalidate('salesforce:status');
        checkStatus();
        setConnecting(false);
        onStatusChange();
        setOauthModal({ type: 'success', detail: data.org_name ? data.org_name : undefined });
      } else if (data?.type === 'salesforce-oauth-error') {
        setConnecting(false);
        setOauthModal({ type: 'error', error: data.message || 'Salesforce connection failed' });
      }
    };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('contndr-oauth-result');
      bc.onmessage = (event) => handleSalesforceResult(event.data);
    } catch (_) {}

    const handleMessage = (event: MessageEvent) => handleSalesforceResult(event.data);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      try { bc?.close(); } catch (_) {}
    };
  }, [checkStatus, onStatusChange]);

  async function handleConnect() {
    try {
      setConnecting(true);
      const sfOrigin = encodeURIComponent(window.location.origin);
      const res = await authenticatedFetch(`${API_BASE}/salesforce/connect?origin=${sfOrigin}`);
      const data = await res.json();
      if (data.auth_url) {
        const w = 600, h = 700;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top = window.screenY + (window.outerHeight - h) / 2;
        const popup = window.open(data.auth_url, 'salesforce-oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`);
        if (!popup || popup.closed) { window.open(data.auth_url, '_blank'); return; }
        const poll = setInterval(() => {
          if (popup.closed) {
            clearInterval(poll);
            setTimeout(() => { apiCache.invalidate('salesforce:status'); checkStatus(); setConnecting(false); onStatusChange(); }, 1500);
          }
        }, 1000);
        setTimeout(() => { clearInterval(poll); setConnecting(false); }, 5 * 60 * 1000);
      } else {
        throw new Error(data.error || 'Failed to get authorization URL');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to start Salesforce connection');
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t('integrationsView.disconnectSalesforceConfirm'))) return;
    try {
      setDisconnecting(true);
      const res = await authenticatedFetch(`${API_BASE}/salesforce/disconnect`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        apiCache.invalidate('salesforce:status');
        setStatus({ connected: false });
        setTestResult(null);
        onStatusChange();
        toast.success(t('integrationsView.salesforceDisconnected'));
      } else {
        throw new Error(data.error || 'Failed to disconnect');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await authenticatedFetch(`${API_BASE}/salesforce/test-connection`);
      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        toast.success(t('integrationsView.salesforceVerified'));
      } else {
        toast.error(data.error || t('integrationsView.connectionTestFailed'));
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
      toast.error(t('integrationsView.connectionTestFailed'));
    } finally {
      setTesting(false);
    }
  }

  async function loadLogs() {
    setLogsLoading(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/salesforce/export-logs`);
      const data = await res.json();
      setLogs(data.logs || []);
    } catch { /* ignore */ } finally {
      setLogsLoading(false);
    }
  }

  if (loading) return <LoadingSpinner center size="md" />;

  return (
    <div className="space-y-4">
      {/* Connected state */}
      {status?.connected ? (
        <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#00A1E0]/10 flex items-center justify-center">
                <SalesforceLogo className="w-[22px] h-[22px]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">{t('integrationsView.salesforceConnected')}</h3>
                  <span className="w-2 h-2 rounded-full bg-[#1ED4A7] animate-pulse" />
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {status.org_name && (
                    <span className="text-[12px] text-zinc-600 dark:text-zinc-300 font-medium">{status.org_name}</span>
                  )}
                  {status.user_email && (
                    <span className="text-[12px] text-zinc-500">{status.user_email}</span>
                  )}
                  {status.instance_url && (
                    <a
                      href={status.instance_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-[#00A1E0] hover:underline flex items-center gap-1"
                    >
                      {status.instance_url.replace('https://', '').split('.')[0]}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {status.connected_at && (
                    <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(status.connected_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-[#00A1E0] dark:hover:text-[#00A1E0] hover:bg-[#00A1E0]/5 border border-transparent hover:border-[#00A1E0]/20 transition-all"
              >
                {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                {t('integrationsView.test')}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-all"
              >
                {disconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                {t('integrationsView.disconnect')}
              </button>
            </div>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`${testResult.success ? 'bg-[#1ED4A7]/5 border-[#1ED4A7]/15' : 'bg-zinc-100 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700'} border rounded-lg p-4 mb-4`}>
              <div className="flex items-start gap-3">
                {testResult.success ? (
                  <ShieldCheck className="w-5 h-5 text-[#1ED4A7] shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-zinc-900 dark:text-white">
                    {testResult.success ? t('integrationsView.connectionVerified') : t('integrationsView.connectionIssue')}
                  </p>
                  {testResult.error && (
                    <p className="text-[11px] text-zinc-500 mt-1">{testResult.error}</p>
                  )}
                  {testResult.api_usage && (
                    <p className="text-[11px] text-zinc-500 mt-1">
                      {t('integrationsView.apiUsage', { used: testResult.api_usage.used ?? '?', max: testResult.api_usage.max ?? '?' })}
                      {testResult.api_usage.remaining != null && <span className="text-zinc-400 ml-1">{t('integrationsView.apiUsageRemaining', { remaining: testResult.api_usage.remaining })}</span>}
                    </p>
                  )}
                  {testResult.permissions && (
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      {t('integrationsView.leadAccess')} {testResult.permissions.can_query_leads ? <span className="text-[#1ED4A7] font-medium">{t('integrationsView.granted')}</span> : <span className="text-zinc-500 font-medium">{t('integrationsView.restricted')}</span>}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* How to use */}
          <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-lg p-4">
            <h4 className="text-[13px] font-medium text-zinc-900 dark:text-white mb-2">{t('integrationsView.howToExportLeads')}</h4>
            <ul className="text-[12px] text-zinc-500 dark:text-zinc-400 space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">1</span>
                {t('integrationsView.sfExportStep1')}
              </li>
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">2</span>
                {t('integrationsView.sfExportStep2Click')} <span className="font-medium text-[#00A1E0]">{t('integrationsView.sfExportStep2Button')}</span> {t('integrationsView.sfExportStep2End')}
              </li>
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">3</span>
                {t('integrationsView.sfExportStep3')}
              </li>
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">4</span>
                {t('integrationsView.sfExportStep4', { link: '' })} <span className="font-medium text-[#00A1E0]">{t('integrationsView.sfBulkExport')}</span>
              </li>
            </ul>
          </div>
        </div>
      ) : (
        /* Disconnected state */
        <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[#00A1E0]/10 flex items-center justify-center">
              <SalesforceLogo className="w-[22px] h-[22px]" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">{t('integrationsView.connectSalesforce')}</h3>
              <p className="text-[12px] text-zinc-500 mt-0.5">
                {t('integrationsView.salesforceDetailDesc')}
              </p>
            </div>
          </div>

          {status?.error && (
            <div className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-[12px] text-zinc-900 dark:text-zinc-100 flex items-center gap-2 mb-4">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {status.error}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 mb-4">
            {['sfFeatureLeads', 'sfFeatureAccounts', 'sfFeatureDedupCheck', 'sfFeatureAutoAssociation', 'sfFeatureOAuth'].map(f => (
              <span key={f} className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400">{t(`integrationsView.${f}`)}</span>
            ))}
          </div>

          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 shadow-sm"
          >
            {connecting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {t('integrationsView.connecting')}</>
            ) : (
              <><ArrowUpRight className="w-4 h-4" /> {t('integrationsView.connectSalesforce')}</>
            )}
          </button>
        </div>
      )}

      {/* Export Activity Log */}
      <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 overflow-hidden">
        <button
          onClick={() => { if (!showLogs && logs.length === 0) loadLogs(); setShowLogs(!showLogs); }}
          className="w-full flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
        >
          <span className="text-[13px] font-medium text-zinc-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-400" />
            {t('integrationsView.exportActivityLog')}
          </span>
          {showLogs ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
        </button>
        {showLogs && (
          <div className="border-t border-zinc-100 dark:border-zinc-800">
            {logsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-[13px] text-zinc-500">{t('integrationsView.noExportActivityYet')}</div>
            ) : (
              <div className="max-h-56 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                {logs.slice(0, 50).map((log: any, i: number) => (
                  <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-[12px]">
                    {log.success !== false ? <CheckCircle2 className="w-3.5 h-3.5 text-[#1ED4A7] shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300 capitalize">{log.type?.replace(/_/g, ' ')}</span>
                      {log.action && <span className="text-zinc-500 ml-1">({log.action})</span>}
                      {log.email && <span className="text-zinc-400 ml-1 truncate block">{log.email}</span>}
                      {log.company_name && !log.email && <span className="text-zinc-400 ml-1 truncate block">{log.company_name}</span>}
                      {log.error && <span className="text-zinc-500 ml-1 truncate block">{log.error}</span>}
                      {log.salesforce_url && (
                        <a href={log.salesforce_url} target="_blank" rel="noreferrer" className="text-[#00A1E0] hover:underline ml-1 text-[11px] inline-flex items-center gap-0.5">
                          {t('integrationsView.viewInSalesforce')} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                    <span className="text-zinc-400 whitespace-nowrap shrink-0">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {oauthModal && (
        <OAuthResultModal
          type={oauthModal.type}
          integrationName="Salesforce"
          detail={oauthModal.detail}
          errorMessage={oauthModal.error}
          logo={<SalesforceLogo className="w-8 h-8" />}
          accentColor="#00A1E0"
          onClose={() => setOauthModal(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Slack Detail
// ═══════════════════════════════════════════════════════════════════════

function SlackDetail({ onStatusChange }: { onStatusChange: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [channels, setChannels] = useState<any[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelDropdownOpen, setChannelDropdownOpen] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [oauthModal, setOauthModal] = useState<{ type: 'success' | 'error'; detail?: string; error?: string } | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      setLoading(true);
      apiCache.invalidate('slack:status');
      const headers = await getAuthHeaders();
      if (!headers.Authorization) { setLoading(false); return; }
      const res = await fetch(`${API_BASE}/slack/status`, { headers });
      const data = await res.json();
      setStatus(data);
    } catch (err: any) {
      setStatus({ connected: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();

    // Handle redirect-based OAuth return (popup was blocked, so the callback
    // set a localStorage flag and redirected the whole page back here)
    try {
      const slackSuccess = localStorage.getItem('contndr-slack-oauth-success');
      const slackError = localStorage.getItem('contndr-slack-oauth-error');
      if (slackSuccess) {
        localStorage.removeItem('contndr-slack-oauth-success');
        apiCache.invalidate('slack:status');
        checkStatus();
        setConnecting(false);
        onStatusChange();
        setOauthModal({ type: 'success' });
      }
      if (slackError) {
        localStorage.removeItem('contndr-slack-oauth-error');
        setConnecting(false);
        setOauthModal({ type: 'error', error: slackError || 'Slack connection failed' });
      }
    } catch (_) {}

    const handleSlackResult = (data: any) => {
      if (data?.type === 'slack-oauth-success') {
        apiCache.invalidate('slack:status');
        checkStatus();
        setConnecting(false);
        onStatusChange();
        setOauthModal({ type: 'success', detail: data.team_name ? data.team_name : undefined });
      } else if (data?.type === 'slack-oauth-error') {
        setConnecting(false);
        setOauthModal({ type: 'error', error: data.message || 'Slack connection failed' });
      }
    };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('contndr-oauth-result');
      bc.onmessage = (event) => handleSlackResult(event.data);
    } catch (_) {}

    const handleMessage = (event: MessageEvent) => handleSlackResult(event.data);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      try { bc?.close(); } catch (_) {}
    };
  }, [checkStatus, onStatusChange]);

  async function handleConnect() {
    try {
      setConnecting(true);
      const origin = encodeURIComponent(window.location.origin);
      const res = await authenticatedFetch(`${API_BASE}/slack/connect?origin=${origin}`);
      const data = await res.json();
      if (data.auth_url) {
        const w = 600, h = 700;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top = window.screenY + (window.outerHeight - h) / 2;
        const popup = window.open(data.auth_url, 'slack-oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`);
        if (!popup || popup.closed) { window.open(data.auth_url, '_blank'); return; }
        const poll = setInterval(() => {
          if (popup.closed) {
            clearInterval(poll);
            setTimeout(() => { apiCache.invalidate('slack:status'); checkStatus(); setConnecting(false); onStatusChange(); }, 1500);
          }
        }, 1000);
        setTimeout(() => { clearInterval(poll); setConnecting(false); }, 5 * 60 * 1000);
      } else {
        throw new Error(data.error || 'Failed to get authorization URL');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to start Slack connection');
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect Slack? You will stop receiving notifications.')) return;
    try {
      setDisconnecting(true);
      const res = await authenticatedFetch(`${API_BASE}/slack/disconnect`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        apiCache.invalidate('slack:status');
        setStatus({ connected: false });
        setChannels([]);
        onStatusChange();
        toast.success('Slack disconnected');
      } else {
        throw new Error(data.error || 'Failed to disconnect');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  async function loadChannels() {
    setChannelsLoading(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/slack/channels`);
      const data = await res.json();
      setChannels(data.channels || []);
    } catch {
      toast.error('Failed to load channels');
    } finally {
      setChannelsLoading(false);
    }
  }

  async function selectChannel(channel: { id: string; name: string }) {
    setSavingSettings(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/slack/settings`, {
        method: 'PATCH',
        body: JSON.stringify({ default_channel_id: channel.id, default_channel_name: channel.name }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus((prev: any) => ({ ...prev, default_channel_id: channel.id, default_channel_name: channel.name }));
        setChannelDropdownOpen(false);
        toast.success(`Channel set to #${channel.name}`);
      }
    } catch {
      toast.error('Failed to save channel');
    } finally {
      setSavingSettings(false);
    }
  }

  async function toggleEvent(eventKey: string, value: boolean) {
    try {
      const res = await authenticatedFetch(`${API_BASE}/slack/settings`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled_events: { [eventKey]: value } }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus((prev: any) => ({ ...prev, enabled_events: { ...prev?.enabled_events, [eventKey]: value } }));
      }
    } catch {
      toast.error('Failed to save setting');
    }
  }

  async function handleTestMessage() {
    setSendingTest(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/slack/test-message`, { method: 'POST' });
      const data = await res.json();
      if (data.success) toast.success('Test message sent!');
      else toast.error(data.error || 'Failed to send test message');
    } catch {
      toast.error('Failed to send test message');
    } finally {
      setSendingTest(false);
    }
  }

  async function loadLogs() {
    setLogsLoading(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/slack/event-log`);
      const data = await res.json();
      setLogs(data.logs || []);
    } catch { /* ignore */ } finally {
      setLogsLoading(false);
    }
  }

  if (loading) return <LoadingSpinner center size="md" />;

  const isConnected = status?.connected;

  return (
    <div className="space-y-4">
      {isConnected ? (
        <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#4A154B]/10 flex items-center justify-center">
                <SlackLogo className="w-[22px] h-[22px]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">Slack Connected</h3>
                  <span className="w-2 h-2 rounded-full bg-[#1ED4A7] animate-pulse" />
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {status.team_name && <span className="text-[12px] text-zinc-600 dark:text-zinc-300 font-medium">{status.team_name}</span>}
                  {status.connected_at && (
                    <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(status.connected_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-all"
            >
              {disconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
              Disconnect
            </button>
          </div>

          {/* Channel Picker */}
          <div className="mb-4">
            <label className="block text-[12px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              <Hash className="w-3 h-3 inline mr-1" />
              Default Channel
            </label>
            <div className="relative">
              <button
                onClick={() => { if (!channelDropdownOpen && channels.length === 0) loadChannels(); setChannelDropdownOpen(!channelDropdownOpen); }}
                disabled={savingSettings}
                className="w-full flex items-center justify-between px-3 py-2.5 text-[13px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-black text-zinc-900 dark:text-white rounded-lg hover:border-zinc-300 dark:hover:border-white/15 transition-colors"
              >
                <span className={status.default_channel_name ? '' : 'text-zinc-400'}>
                  {status.default_channel_name ? `#${status.default_channel_name}` : 'Select a channel...'}
                </span>
                {channelsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" /> : <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${channelDropdownOpen ? 'rotate-180' : ''}`} />}
              </button>
              {channelDropdownOpen && (
                <div className="absolute z-20 top-full mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg">
                  {channelsLoading ? (
                    <div className="flex items-center justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-zinc-400" /></div>
                  ) : channels.length === 0 ? (
                    <div className="text-center py-4 text-[12px] text-zinc-500">No channels found</div>
                  ) : channels.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => selectChannel(ch)}
                      className={`w-full text-left px-3 py-2 text-[12px] hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-2 ${ch.id === status.default_channel_id ? 'bg-[#1ED4A7]/5 text-[#1ED4A7] font-medium' : 'text-zinc-700 dark:text-zinc-300'}`}
                    >
                      <Hash className="w-3 h-3 text-zinc-400 shrink-0" />
                      {ch.name}
                      {ch.num_members > 0 && <span className="text-[10px] text-zinc-400 ml-auto">{ch.num_members} members</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Event Toggles */}
          <div className="mb-4">
            <label className="block text-[12px] font-medium text-zinc-500 dark:text-zinc-400 mb-2">
              <Bell className="w-3 h-3 inline mr-1" />
              Notification Events
            </label>
            <div className="space-y-1.5">
              {([
                { key: 'new_lead', label: 'New lead added', desc: 'When a lead is saved to your CRM' },
                { key: 'reply', label: 'Reply received', desc: 'When a lead replies to your outreach' },
                { key: 'meeting_booked', label: 'Meeting booked', desc: 'When a calendar event is created' },
                { key: 'campaign_started', label: 'Campaign started', desc: 'When a campaign goes live' },
              ] as const).map((evt) => {
                const enabled = status?.enabled_events?.[evt.key] ?? true;
                return (
                  <button key={evt.key} onClick={() => toggleEvent(evt.key, !enabled)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-zinc-100 dark:border-zinc-800 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors text-left">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-zinc-700 dark:text-zinc-300 font-medium">{evt.label}</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5">{evt.desc}</p>
                    </div>
                    <div className={`w-8 h-[18px] rounded-full transition-colors relative shrink-0 ${enabled ? 'bg-[#1ED4A7]' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
                      <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-[16px]' : 'translate-x-[2px]'}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Test Message */}
          <button onClick={handleTestMessage} disabled={sendingTest || !status.default_channel_id} className="w-full py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 shadow-sm">
            {sendingTest ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</> : <><Send className="w-4 h-4" /> Send Test Message</>}
          </button>
          {!status.default_channel_id && <p className="text-[11px] text-zinc-400 mt-1.5 text-center">Select a channel first to send a test message</p>}
        </div>
      ) : (
        <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[#4A154B]/10 flex items-center justify-center">
              <SlackLogo className="w-[22px] h-[22px]" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">Connect Slack</h3>
              <p className="text-[12px] text-zinc-500 mt-0.5">Get real-time notifications in Slack for lead activity, replies, meetings, and campaigns</p>
            </div>
          </div>
          {status?.error && (
            <div className="bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-[12px] text-zinc-700 dark:text-zinc-300 flex items-center gap-2 mb-4">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />{status.error}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {['Channel notifications', 'Event toggles', 'Test messages', 'OAuth 2.0'].map((f: string) => (
              <span key={f} className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400">{f}</span>
            ))}
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-lg p-4 mb-4">
            <h4 className="text-[13px] font-medium text-zinc-900 dark:text-white mb-2">What you'll get</h4>
            <ul className="text-[12px] text-zinc-500 dark:text-zinc-400 space-y-1.5">
              <li className="flex items-start gap-2"><span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">1</span>Instant notification when a new lead is added</li>
              <li className="flex items-start gap-2"><span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">2</span>Alert when a lead replies to your outreach</li>
              <li className="flex items-start gap-2"><span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">3</span>Notification when a meeting is booked</li>
              <li className="flex items-start gap-2"><span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">4</span>Alert when a campaign goes live</li>
            </ul>
          </div>
          <button onClick={handleConnect} disabled={connecting} className="w-full py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 shadow-sm">
            {connecting ? <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</> : <><ArrowUpRight className="w-4 h-4" /> Connect Slack</>}
          </button>
        </div>
      )}

      {/* Notification Log */}
      <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 overflow-hidden">
        <button onClick={() => { if (!showLogs && logs.length === 0) loadLogs(); setShowLogs(!showLogs); }} className="w-full flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
          <span className="text-[13px] font-medium text-zinc-900 dark:text-white flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-zinc-400" />
            Notification Log
          </span>
          {showLogs ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
        </button>
        {showLogs && (
          <div className="border-t border-zinc-100 dark:border-zinc-800">
            {logsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-[13px] text-zinc-500">No notification activity yet</div>
            ) : (
              <div className="max-h-56 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                {logs.slice(0, 50).map((log: any, i: number) => (
                  <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-[12px]">
                    {log.success !== false ? <CheckCircle2 className="w-3.5 h-3.5 text-[#1ED4A7] shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300 capitalize">{log.type?.replace(/_/g, ' ')}</span>
                      {log.channel_name && <span className="text-zinc-400 ml-1">#{log.channel_name}</span>}
                      {log.error && <span className="text-zinc-500 ml-1 truncate block">{log.error}</span>}
                    </div>
                    <span className="text-zinc-400 whitespace-nowrap shrink-0">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {oauthModal && (
        <OAuthResultModal
          type={oauthModal.type}
          integrationName="Slack"
          detail={oauthModal.detail}
          errorMessage={oauthModal.error}
          logo={<SlackLogo className="w-8 h-8" />}
          accentColor="#4A154B"
          onClose={() => setOauthModal(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// QuickBooks Detail
// ═══════════════════════════════════════════════════════════════════════

function QuickBooksDetail({ onStatusChange }: { onStatusChange: () => void }) {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [oauthModal, setOauthModal] = useState<{ type: 'success' | 'error'; detail?: string; error?: string } | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      setLoading(true);
      apiCache.invalidate('quickbooks:status');
      const headers = await getAuthHeaders();
      if (!headers.Authorization) { setLoading(false); return; }
      const res = await fetch(`${API_BASE}/quickbooks/status`, { headers });
      const data = await res.json();
      setStatus(data);

      if (data?.connected) {
        try {
          const syncRes = await fetch(`${API_BASE}/quickbooks/sync/status`, { headers });
          const syncData = await syncRes.json();
          setSyncStatus(syncData);
        } catch { /* ignore */ }
      }
    } catch (err: any) {
      setStatus({ connected: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();

    try {
      const qbSuccess = localStorage.getItem('contndr-quickbooks-oauth-success');
      const qbError = localStorage.getItem('contndr-quickbooks-oauth-error');
      if (qbSuccess) {
        localStorage.removeItem('contndr-quickbooks-oauth-success');
        apiCache.invalidate('quickbooks:status');
        checkStatus();
        setConnecting(false);
        onStatusChange();
        setOauthModal({ type: 'success' });
      }
      if (qbError) {
        localStorage.removeItem('contndr-quickbooks-oauth-error');
        setConnecting(false);
        setOauthModal({ type: 'error', error: qbError || 'QuickBooks connection failed' });
      }
    } catch (_) {}

    const handleQuickBooksResult = (data: any) => {
      if (data?.type === 'quickbooks-oauth-success') {
        apiCache.invalidate('quickbooks:status');
        checkStatus();
        setConnecting(false);
        onStatusChange();
        setOauthModal({ type: 'success', detail: data.company_name ? data.company_name : undefined });
      } else if (data?.type === 'quickbooks-oauth-error') {
        setConnecting(false);
        setOauthModal({ type: 'error', error: data.message || 'QuickBooks connection failed' });
      }
    };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('contndr-oauth-result');
      bc.onmessage = (event) => handleQuickBooksResult(event.data);
    } catch (_) {}

    const handleMessage = (event: MessageEvent) => handleQuickBooksResult(event.data);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      try { bc?.close(); } catch (_) {}
    };
  }, [checkStatus, onStatusChange]);

  async function handleConnect() {
    try {
      setConnecting(true);
      const res = await authenticatedFetch(`${API_BASE}/quickbooks/connect?origin=${encodeURIComponent(window.location.origin)}`);
      const data = await res.json();
      if (data.auth_url) {
        const w = 600, h = 700;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top = window.screenY + (window.outerHeight - h) / 2;
        const popup = window.open(data.auth_url, 'quickbooks-oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`);
        if (!popup || popup.closed) { window.open(data.auth_url, '_blank'); return; }
        const poll = setInterval(() => {
          if (popup.closed) {
            clearInterval(poll);
            setTimeout(() => { apiCache.invalidate('quickbooks:status'); checkStatus(); setConnecting(false); onStatusChange(); }, 1500);
          }
        }, 1000);
        setTimeout(() => { clearInterval(poll); setConnecting(false); }, 5 * 60 * 1000);
      } else {
        throw new Error(data.error || 'Failed to get authorization URL');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to start QuickBooks connection');
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect QuickBooks? Synced data will be removed.')) return;
    try {
      setDisconnecting(true);
      const res = await authenticatedFetch(`${API_BASE}/quickbooks/disconnect`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        apiCache.invalidate('quickbooks:status');
        setStatus({ connected: false });
        setSyncStatus(null);
        setSyncResult(null);
        onStatusChange();
        toast.success('QuickBooks disconnected');
      } else {
        throw new Error(data.error || 'Failed to disconnect');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await authenticatedFetch(`${API_BASE}/quickbooks/sync/now`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSyncResult(data);
        toast.success('QuickBooks data synced successfully!');
        await checkStatus();
      } else {
        throw new Error(data.error || 'Sync failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Sync failed');
      setSyncResult({ error: err.message });
    } finally {
      setSyncing(false);
    }
  }

  async function loadLogs() {
    setLogsLoading(true);
    try {
      const res = await authenticatedFetch(`${API_BASE}/quickbooks/sync-logs`);
      const data = await res.json();
      setLogs(data.logs || []);
    } catch { /* ignore */ } finally {
      setLogsLoading(false);
    }
  }

  if (loading) return <LoadingSpinner center size="md" />;

  return (
    <div className="space-y-4">
      {status?.connected ? (
        <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#2CA01C]/10 flex items-center justify-center">
                <QuickBooksLogo className="w-[22px] h-[22px]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">QuickBooks Connected</h3>
                  <span className="w-2 h-2 rounded-full bg-[#1ED4A7] animate-pulse" />
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {status.company_name && (
                    <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">{status.company_name}</span>
                  )}
                  {status.realm_id && (
                    <span className="text-[12px] text-zinc-500">Realm: <span className="font-medium text-zinc-700 dark:text-zinc-300">{status.realm_id}</span></span>
                  )}
                  {status.connected_at && (
                    <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(status.connected_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-all"
            >
              {disconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
              Disconnect
            </button>
          </div>

          {syncStatus?.summary && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              {Object.entries(syncStatus.summary as Record<string, { count: number; last_synced: string | null }>).map(([key, val]) => (
                <div key={key} className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-lg p-3 text-center">
                  <p className="text-[20px] font-bold text-zinc-900 dark:text-white">{val.count}</p>
                  <p className="text-[11px] text-zinc-500 capitalize">{key}s</p>
                </div>
              ))}
            </div>
          )}

          {status.last_sync_at && (
            <div className="text-[11px] text-zinc-400 mb-4 flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3" />
              Last synced: {new Date(status.last_sync_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}

          {syncResult && !syncResult.error && (
            <div className="bg-[#1ED4A7]/5 border border-[#1ED4A7]/15 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-[#1ED4A7]" />
                <span className="text-[12px] font-medium text-zinc-900 dark:text-white">Sync completed</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {syncResult.results && Object.entries(syncResult.results as Record<string, { count?: number; success: boolean; error?: string }>).map(([key, val]) => (
                  <div key={key} className="text-[11px]">
                    <span className="capitalize text-zinc-600 dark:text-zinc-400">{key}: </span>
                    {val.success ? (
                      <span className="text-[#1ED4A7] font-medium">{val.count ?? 0}</span>
                    ) : (
                      <span className="text-zinc-500 font-medium">Failed</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {syncResult?.error && (
            <div className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-[12px] text-zinc-900 dark:text-zinc-100 flex items-center gap-2 mb-4">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {syncResult.error}
            </div>
          )}

          <button
            onClick={handleSyncNow}
            disabled={syncing}
            className="w-full py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 shadow-sm"
          >
            {syncing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Syncing...</>
            ) : (
              <><RefreshCw className="w-4 h-4" /> Sync Now</>
            )}
          </button>

          <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-lg p-4 mt-4">
            <h4 className="text-[13px] font-medium text-zinc-900 dark:text-white mb-2">What gets synced</h4>
            <ul className="text-[12px] text-zinc-500 dark:text-zinc-400 space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">1</span>
                <span><span className="font-medium text-zinc-700 dark:text-zinc-300">Customers</span> — Names, emails, balances</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">2</span>
                <span><span className="font-medium text-zinc-700 dark:text-zinc-300">Invoices</span> — Amounts, statuses, due dates</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">3</span>
                <span><span className="font-medium text-zinc-700 dark:text-zinc-300">Payments</span> — Received payments, amounts, methods</span>
              </li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[#2CA01C]/10 flex items-center justify-center">
              <QuickBooksLogo className="w-[22px] h-[22px]" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">Connect QuickBooks</h3>
              <p className="text-[12px] text-zinc-500 mt-0.5">Sync your financial data from QuickBooks Online</p>
            </div>
          </div>

          {status?.error && (
            <div className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-[12px] text-zinc-900 dark:text-zinc-100 flex items-center gap-2 mb-4">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {status.error}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 mb-4">
            {['Invoices', 'Customers', 'Payments', 'Incremental sync', 'OAuth 2.0'].map(f => (
              <span key={f} className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400">{f}</span>
            ))}
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-lg p-4 mb-4">
            <h4 className="text-[13px] font-medium text-zinc-900 dark:text-white mb-2">What you'll get</h4>
            <ul className="text-[12px] text-zinc-500 dark:text-zinc-400 space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">1</span>
                Customer records synced to your Contndr dashboard
              </li>
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">2</span>
                Invoice tracking with amounts, statuses, and due dates
              </li>
              <li className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">3</span>
                Payment history for revenue insights
              </li>
            </ul>
          </div>

          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 shadow-sm"
          >
            {connecting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</>
            ) : (
              <><ArrowUpRight className="w-4 h-4" /> Connect QuickBooks</>
            )}
          </button>

          <p className="text-[11px] text-zinc-400 mt-3 text-center">
            You'll be redirected to Intuit to authorize access.
            Only <span className="font-medium">read-only accounting</span> permission is requested.
          </p>
        </div>
      )}

      {/* Sync Activity Log */}
      <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 overflow-hidden">
        <button
          onClick={() => { if (!showLogs && logs.length === 0) loadLogs(); setShowLogs(!showLogs); }}
          className="w-full flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
        >
          <span className="text-[13px] font-medium text-zinc-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-400" />
            Sync Activity Log
          </span>
          {showLogs ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
        </button>
        {showLogs && (
          <div className="border-t border-zinc-100 dark:border-zinc-800">
            {logsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-[13px] text-zinc-500">No sync activity yet</div>
            ) : (
              <div className="max-h-56 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                {logs.slice(0, 50).map((log: any, i: number) => (
                  <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-[12px]">
                    {log.success !== false ? <CheckCircle2 className="w-3.5 h-3.5 text-[#1ED4A7] shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300 capitalize">{log.type?.replace(/_/g, ' ')}</span>
                      {log.company_name && <span className="text-zinc-400 ml-1">({log.company_name})</span>}
                      {log.error && <span className="text-zinc-500 ml-1 truncate block">{log.error}</span>}
                    </div>
                    <span className="text-zinc-400 whitespace-nowrap shrink-0">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Configuration info - hidden for users */}
      {false && (
      <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-zinc-400" />
          <span className="text-[13px] font-medium text-zinc-900 dark:text-white">Configuration</span>
        </div>
        <div className="text-[12px] text-zinc-500 dark:text-zinc-400 space-y-2">
          <p>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Redirect URI</span> — Register this in your{' '}
            <a href="https://developer.intuit.com/app/developer/dashboard" target="_blank" rel="noreferrer" className="text-zinc-600 dark:text-zinc-300 underline hover:no-underline font-medium">
              Intuit Developer Dashboard
            </a>:
          </p>
          <code className="block px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 break-all select-all">
            {`${window.location.protocol}//${window.location.host}/api/integrations/quickbooks/callback`}
          </code>
          <p className="text-[11px] text-zinc-400">
            If using Supabase Edge Functions directly, use the function URL instead.
          </p>
        </div>
      </div>
      )}

      {oauthModal && (
        <OAuthResultModal
          type={oauthModal.type}
          integrationName="QuickBooks"
          detail={oauthModal.detail}
          errorMessage={oauthModal.error}
          logo={<QuickBooksLogo className="w-8 h-8" />}
          accentColor="#2CA01C"
          onClose={() => setOauthModal(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Telnyx Detail (Setup Wizard + Phone Numbers)
// ═══════════════════════════════════════════════════════════════════════

function TelnyxDetail({ onStatusChange }: { onStatusChange: () => void }) {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showPhoneNumbers, setShowPhoneNumbers] = useState(false);

  const checkConfig = useCallback(async () => {
    try {
      setLoading(true);
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/telnyx/config`, { headers });
      if (!res.ok) {
        setConfig({ connected: false });
        return;
      }
      const data = await res.json();
      setConfig({
        connected: !!data?.config?.api_key_configured && data?.config?.account_status === 'active',
        ...data?.config,
      });
    } catch {
      setConfig({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkConfig(); }, [checkConfig]);

  async function handleDisconnect() {
    if (!confirm('Disconnect Telnyx? Your API key and connection ID will be removed.')) return;
    try {
      setDisconnecting(true);
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/telnyx/config`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        setConfig({ connected: false });
        onStatusChange();
        toast.success('Telnyx disconnected');
      } else {
        throw new Error('Failed to disconnect');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) return <LoadingSpinner center size="md" />;

  const isConnected = config?.connected;

  if (isConnected) {
    return (
      <div className="space-y-4">
        {/* Connected header card */}
        <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 overflow-hidden">
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#28D590]/10 flex items-center justify-center">
                  <TelnyxLogo className="w-[22px] h-[22px]" />
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">Telnyx Connected</h3>
                  <p className="text-[12px] text-zinc-500 mt-0.5">
                    Account {config?.account_status === 'active' ? 'active' : 'inactive'}
                    {config?.phone_numbers_count != null && ` \u00b7 ${config.phone_numbers_count} number${config.phone_numbers_count !== 1 ? 's' : ''}`}
                    {config?.balance != null && ` \u00b7 $${config.balance.toFixed(2)} balance`}
                  </p>
                </div>
              </div>
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#1ED4A7]/10 text-[#1ED4A7]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#1ED4A7] animate-pulse" />
                Connected
              </span>
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowPhoneNumbers(!showPhoneNumbers)}
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-medium border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
              >
                <Phone className="w-4 h-4" />
                {showPhoneNumbers ? 'Hide Numbers' : 'Phone Numbers'}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-medium border border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-red-500 hover:border-red-300 dark:hover:border-red-500/30 transition-colors disabled:opacity-50"
              >
                {disconnecting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Disconnecting...</>
                ) : (
                  <><Trash2 className="w-4 h-4" /> Disconnect</>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Phone numbers panel */}
        {showPhoneNumbers && (
          <TelnyxPhoneNumbers onClose={() => setShowPhoneNumbers(false)} />
        )}
      </div>
    );
  }

  // Not connected — show setup wizard
  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-black rounded-xl border border-zinc-200 dark:border-white/10 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[#28D590]/10 flex items-center justify-center">
            <TelnyxLogo className="w-[22px] h-[22px]" />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">Connect Telnyx</h3>
            <p className="text-[12px] text-zinc-500 mt-0.5">Set up your telephony provider for AI calls</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {['AI Calls', 'Phone Numbers', 'Call Recording', 'SIP Trunking'].map(f => (
            <span key={f} className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400">{f}</span>
          ))}
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-lg p-4 mb-4">
          <h4 className="text-[13px] font-medium text-zinc-900 dark:text-white mb-2">What you'll set up</h4>
          <ul className="text-[12px] text-zinc-500 dark:text-zinc-400 space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">1</span>
              Create a Telnyx account and get your API key
            </li>
            <li className="flex items-start gap-2">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">2</span>
              Set up a TeXML Call Control application
            </li>
            <li className="flex items-start gap-2">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">3</span>
              Sync your phone numbers for AI outbound calls
            </li>
          </ul>
        </div>
      </div>

      <TelnyxApiKeySetup
        onComplete={() => {
          checkConfig();
          onStatusChange();
        }}
      />
    </div>
  );
}
