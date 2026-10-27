export type ViewPreferences={group:'default'|'none'|'date'|'board';sort:'manual'|'date'};
export type User={id:number;username:string;is_admin:boolean;active:boolean};
export type BoardSummary={id:number;title:string;revision:number};
export type List={id:number;board_id:number;title:string;position:number};
export type Repeat={unit:string;interval:number;mode:string;weekdays:number[];until?:string;count?:number};
export type Schedule={start_date:string;end_date?:string;start_time?:string;end_time?:string;timezone:string;repeat?:Repeat};
export type Card={touch_version:number;id:number;list_id:number;title:string;description:string;position:number;archived:boolean;completed:boolean;skipped:boolean;schedule:Schedule|null;series_id:string|null;predecessor_id:number|null;occurrence_no:number;assignee_id:number|null;due_date:string|null};
export type Member={user_id:number;username:string;role:string;active:boolean};
export type ChecklistItem={id:number;card_id:number;title:string;checked:boolean;position:number};
export type Comment={id:number;card_id:number;author_id:number;author:string;body:string;created_at:number};
export type Board=BoardSummary & {inbox_owner_id?:number;role:string;lists:List[];cards:Card[];members:Member[];checklist:ChecklistItem[];comments:Comment[]};
export type ScheduleDraft={enabled:boolean;start:string;end:string;startTime:string;endTime:string;unit:string;interval:number|undefined;mode:string;weekdays:number[];ending:string;until:string;count:number|undefined};
export type Draft=Card & {revision:number;scheduleInput:ScheduleDraft};

export type TaskFilters={q:string;view:string;status:string;assignee_id:string;board_id:string;from:string;to:string};
export type TaskResult=Pick<Card,'id'|'title'|'description'|'completed'|'skipped'|'assignee_id'|'due_date'|'schedule'|'list_id'|'position'> & {board_id:number;board_title:string;list_title:string;list_position:number;assignee_name:string|null};

export type TaskDiscoveryResponse={tasks:TaskResult[];boards:BoardSummary[];inbox:BoardSummary|null;people:{id:number;name:string}[]};

export type TransferPreview={card_id:number;source_board_id:number;source_list_id:number;source_revision:number;target_board_id:number;target_list_id:number;target_revision:number;cards:{id:number;touch_version:number}[];task_count:number;archived_count:number;completed_count:number;skipped_count:number;comment_count:number;checklist_count:number;attachment_count:number;attachment_bytes:number};

export type ExportSelection={board_ids:number[];include_completed:boolean;include_archived:boolean;format:'csv'|'json'|'zip'};
export type ExportPreview={expected_snapshot:string;task_count:number;checklist_count:number;comment_count:number;attachment_count:number;metadata_bytes:number;includes_attachment_content:boolean;ready_original_count?:number;ready_original_bytes?:number;excluded_attachment_count?:number};

export type TemplateSummary={id:number;name:string;revision:number};
export type TaskTemplate=TemplateSummary & {title:string;description:string;checklist:{title:string;position:number}[]};

export type SelectedTask={id:number;board_id:number};
export type SelectionProps={selecting?:boolean;selected?:SelectedTask[];onselect?:(task:SelectedTask)=>void;onvisible?:(scope:string,rows:SelectedTask[])=>void};
export type BulkChanges={target_list:{op:'keep'}|{op:'set';value:number};schedule:{op:'keep'}|{op:'clear'}|{op:'set';value:Schedule};completed:{op:'keep'}|{op:'set';value:boolean};archived:{op:'keep'}|{op:'set';value:boolean}};
