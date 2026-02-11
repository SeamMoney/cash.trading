"use client"

import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { PointsView } from "@/components/points/points-view"

export default function PointsPage() {
  return (
    <DashboardLayout>
      <PointsView />
    </DashboardLayout>
  )
}
