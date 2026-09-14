declare global {
  interface PlanningCostCenter { id:string; code:string; name:string; parent_id?:string|null; active:number|boolean; created_at?:string; updated_at?:string }
  interface PlanningTag { id:string; name:string; active:number|boolean }
  interface EntryAllocation { entryId:string; costCenterId:string; code:string; name:string; amountCents:number; percentageBasisPoints:number }
  interface BudgetScenario { id:string; name:string; kind:'BASE'|'OPTIMISTIC'|'PESSIMISTIC'|'CUSTOM'; active:number|boolean }
  interface PlanningBudget { id:string; scenario_id:string; scenario_name?:string; year:number; month:number; nature:'REVENUE'|'EXPENSE'; amount_cents:number; category_id?:string|null; category_name?:string|null; cost_center_id?:string|null; cost_center_name?:string|null; notes?:string|null }
  interface FinancialGoalRecord { id:string; name:string; metric:'REVENUE'|'EXPENSE'|'BALANCE'|'RESULT'; target_cents:number; period_start:string; period_end:string; active:number|boolean }
  interface BudgetComparison { budgetId:string; scenarioId:string; year:number; month:number; nature:'REVENUE'|'EXPENSE'; plannedCents:number; actualCents:number; committedCents:number; projectedCents:number; varianceCents:number; categoryId?:string|null; costCenterId?:string|null }
  interface ApprovalPolicyRecord { id:string; name:string; min_amount_cents:number; required_approvals:number; approver_roles_json:string; active:number|boolean }
  interface ApprovalRequestRecord { id:string; entry_id?:string|null; entry_description?:string|null; amount_cents?:number|null; policy_id?:string|null; status:'PENDING'|'APPROVED'|'REJECTED'|'CANCELLED'; required_approvals:number; created_at:string }
  interface PlanningProjectionRow { month:string; openingBalanceCents:number; baseNetCents:number; adjustmentCents:number; netCents:number; closingBalanceCents:number }
  interface EntryAttachmentRecord { id:string; entry_id:string; workspace_path:string; filename:string; mime_type?:string|null; extracted_text?:string|null; review_status:'PENDING'|'REVIEWED'; created_at:string }
  interface AttachmentOcrResult { id:string; entryId:string; extractedText:string; provider:string|null; confidence:number|null; reviewStatus:'PENDING' }
  interface Window {
    financeiroPlanning?: {
      listCostCenters(token:string,filters?:Record<string,unknown>):Promise<PlanningCostCenter[]>;
      saveCostCenter(token:string,input:Record<string,unknown>):Promise<PlanningCostCenter>;
      listTags(token:string,filters?:Record<string,unknown>):Promise<PlanningTag[]>;
      saveTag(token:string,input:Record<string,unknown>):Promise<PlanningTag>;
      getAllocations(token:string,entryId:string):Promise<EntryAllocation[]>;
      setAllocations(token:string,entryId:string,allocations:Array<Record<string,unknown>>):Promise<EntryAllocation[]>;
      getEntryTags(token:string,entryId:string):Promise<PlanningTag[]>;
      setEntryTags(token:string,entryId:string,tagIds:string[]):Promise<PlanningTag[]>;
      listScenarios(token:string,filters?:Record<string,unknown>):Promise<BudgetScenario[]>;
      saveScenario(token:string,input:Record<string,unknown>):Promise<BudgetScenario>;
      listBudgets(token:string,filters?:Record<string,unknown>):Promise<PlanningBudget[]>;
      saveBudget(token:string,input:Record<string,unknown>):Promise<PlanningBudget>;
      compareBudget(token:string,filters?:Record<string,unknown>):Promise<BudgetComparison[]>;
      listGoals(token:string,filters?:Record<string,unknown>):Promise<FinancialGoalRecord[]>;
      saveGoal(token:string,input:Record<string,unknown>):Promise<FinancialGoalRecord>;
      listAttachments(token:string,entryId:string):Promise<EntryAttachmentRecord[]>;
      addAttachment(token:string,entryId:string,input:Record<string,unknown>):Promise<EntryAttachmentRecord>;
      reviewAttachment(token:string,id:string):Promise<EntryAttachmentRecord>;
      runAttachmentOcr(token:string,id:string):Promise<AttachmentOcrResult>;
      listApprovalPolicies(token:string,filters?:Record<string,unknown>):Promise<ApprovalPolicyRecord[]>;
      saveApprovalPolicy(token:string,input:Record<string,unknown>):Promise<ApprovalPolicyRecord>;
      listApprovals(token:string,filters?:Record<string,unknown>):Promise<ApprovalRequestRecord[]>;
      requestApproval(token:string,input:Record<string,unknown>):Promise<ApprovalRequestRecord>;
      decideApproval(token:string,requestId:string,input:Record<string,unknown>):Promise<ApprovalRequestRecord>;
      runBulk(token:string,input:Record<string,unknown>):Promise<{action:string;count:number;entryIds:string[]}>;
      projection(token:string,input?:Record<string,unknown>):Promise<PlanningProjectionRow[]>;
    };
  }
}
export {};
