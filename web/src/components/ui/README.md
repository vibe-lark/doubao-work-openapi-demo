# shadcn/ui kit — component index

Vendored shadcn/ui (new-york style, React 19 ref-as-prop). Import from `@/components/ui/<file>`, e.g.
`import { Button } from "@/components/ui/button"`. All components are skinned by the CSS variables in
`src/themes/*` via `src/styles.css` — use them as-is, don't restyle. `cn()` lives at `@/lib/utils`.
Higher-level, ready-to-use compositions (DataTable, Markdown, StatCard, EmptyState, ErrorBoundary) are
in `@/components/kit/*` — prefer those before wiring primitives by hand.

One line per file so you can pick a component without reading source.

## Actions & inputs
| File | Key exports | Use |
| --- | --- | --- |
| `button.tsx` | Button, buttonVariants | Primary action element; variants default/destructive/outline/secondary/ghost/link, sizes incl. icon. |
| `button-group.tsx` | ButtonGroup, ButtonGroupSeparator, ButtonGroupText | Join related buttons into one segmented control. |
| `toggle.tsx` | Toggle, toggleVariants | Single on/off pressable button. |
| `toggle-group.tsx` | ToggleGroup, ToggleGroupItem | Set of toggles, single- or multi-select. |
| `input.tsx` | Input | Standard single-line text input. |
| `input-group.tsx` | InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea | Input with leading/trailing addons (icons, buttons, text). |
| `input-otp.tsx` | InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator | One-time-code / PIN entry with per-digit slots. |
| `textarea.tsx` | Textarea | Multi-line text input. |
| `checkbox.tsx` | Checkbox | Boolean checkbox. |
| `radio-group.tsx` | RadioGroup, RadioGroupItem | Mutually exclusive choice set. |
| `switch.tsx` | Switch | On/off toggle switch. |
| `slider.tsx` | Slider | Numeric range slider. |
| `select.tsx` | Select, SelectTrigger, SelectContent, SelectItem, SelectValue, … | Styled dropdown select (Radix, custom popover). |
| `native-select.tsx` | NativeSelect, NativeSelectOptGroup, NativeSelectOption | Native `<select>` styled to match — best for long/mobile lists. |
| `label.tsx` | Label | Form field label wired to controls. |
| `field.tsx` | Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldSet, … | Layout scaffolding for a labelled form field + validation text. |
| `form.tsx` | Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage, useFormField | react-hook-form bindings for validated forms. |
| `calendar.tsx` | Calendar, CalendarDayButton | Date picker grid (react-day-picker v9). |

## Layout & containers
| File | Key exports | Use |
| --- | --- | --- |
| `card.tsx` | Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter | Standard content card. |
| `separator.tsx` | Separator | Thin horizontal/vertical divider. |
| `aspect-ratio.tsx` | AspectRatio | Lock a child to a fixed width:height ratio. |
| `scroll-area.tsx` | ScrollArea, ScrollBar | Custom-scrollbar scroll container. |
| `resizable.tsx` | ResizablePanelGroup, ResizablePanel, ResizableHandle | Draggable split panes. |
| `tabs.tsx` | Tabs, TabsList, TabsTrigger, TabsContent | Tabbed sections. |
| `accordion.tsx` | Accordion, AccordionItem, AccordionTrigger, AccordionContent | Expand/collapse stacked sections. |
| `collapsible.tsx` | Collapsible, CollapsibleTrigger, CollapsibleContent | Single show/hide region. |
| `sidebar.tsx` | Sidebar, SidebarProvider, SidebarMenu, SidebarMenuItem, SidebarTrigger, useSidebar, … | Full collapsible app sidebar system (needs SidebarProvider). |
| `item.tsx` | Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions, … | Generic list-row/media-object layout. |

## Navigation
| File | Key exports | Use |
| --- | --- | --- |
| `breadcrumb.tsx` | Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, … | Hierarchical page trail. |
| `pagination.tsx` | Pagination, PaginationContent, PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis | Page navigation controls (presentational). |
| `navigation-menu.tsx` | NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuTrigger, NavigationMenuContent, navigationMenuTriggerStyle | Top-level nav bar with dropdown panels. |
| `menubar.tsx` | Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSub, … | Desktop-app menu bar (File/Edit/…). |

## Overlays & menus
| File | Key exports | Use |
| --- | --- | --- |
| `dialog.tsx` | Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose | Centered modal dialog. |
| `alert-dialog.tsx` | AlertDialog, AlertDialogContent, AlertDialogAction, AlertDialogCancel, AlertDialogTitle, … | Confirm/destructive modal (replaces window.confirm). |
| `sheet.tsx` | Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, SheetClose | Edge-anchored slide-in panel. |
| `drawer.tsx` | Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter, DrawerClose, … | Bottom-sheet drawer (vaul); mobile-friendly. |
| `popover.tsx` | Popover, PopoverTrigger, PopoverContent, PopoverAnchor | Floating panel anchored to a trigger. |
| `hover-card.tsx` | HoverCard, HoverCardTrigger, HoverCardContent | Preview card on hover. |
| `tooltip.tsx` | Tooltip, TooltipTrigger, TooltipContent, TooltipProvider | Small hover/focus hint. |
| `dropdown-menu.tsx` | DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSub, … | Click-triggered action menu. |
| `context-menu.tsx` | ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSub, … | Right-click menu. |
| `command.tsx` | Command, CommandDialog, CommandInput, CommandList, CommandItem, CommandGroup, CommandEmpty, … | Command palette / searchable list (cmdk). |

## Feedback & status
| File | Key exports | Use |
| --- | --- | --- |
| `alert.tsx` | Alert, AlertTitle, AlertDescription | Inline info/warning/error banner. |
| `sonner.tsx` | Toaster | Toast host — mount once; fire toasts with `import { toast } from "sonner"`. |
| `progress.tsx` | Progress | Determinate progress bar. |
| `skeleton.tsx` | Skeleton | Loading placeholder block. |
| `spinner.tsx` | Spinner | Indeterminate loading spinner. |
| `empty.tsx` | Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia | Rich empty-state scaffold (see also `kit/empty-state`). |

## Data display
| File | Key exports | Use |
| --- | --- | --- |
| `table.tsx` | Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption | Raw table primitives (see `kit/data-table` for sorting/paging/card-ify). |
| `badge.tsx` | Badge, badgeVariants | Small status/label pill. |
| `avatar.tsx` | Avatar, AvatarImage, AvatarFallback | User/entity avatar with fallback. |
| `chart.tsx` | ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle | Recharts theming wrapper (uses --chart-1..5 tokens). |
| `carousel.tsx` | Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext, type CarouselApi | Sliding content carousel (embla). |
| `kbd.tsx` | Kbd, KbdGroup | Keyboard-key hint glyphs. |
