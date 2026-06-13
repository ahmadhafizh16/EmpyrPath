import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import { PageHero } from "@/shared/components";
import { SECTIONS } from "@/shared/constants/dashboardSections";
import ProviderLimits from "../usage/components/ProviderLimits";

const S = SECTIONS.quota;

export default function QuotaPage() {
  return (
    <div data-section={S.color} className="flex flex-col gap-6">
      <PageHero
        section={S.color}
        eyebrow={S.eyebrow}
        title={S.title}
        description={S.description}
        icon={S.icon}
      />
      <Suspense fallback={<CardSkeleton />}>
        <ProviderLimits />
      </Suspense>
    </div>
  );
}
