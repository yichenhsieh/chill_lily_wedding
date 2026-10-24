-- Chill & Lily 管理員全桌次唯讀查詢：不修改賓客或座位資料
CREATE OR REPLACE FUNCTION public.admin_wedding_table_guests()
RETURNS TABLE (
  table_number integer,
  guest_name text,
  expected_count integer,
  checked_in_count integer,
  is_checked_in boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp
    WHERE sp.user_id = auth.uid()
      AND sp.active = true AND sp.role = 'admin'
  ) THEN
    RAISE EXCEPTION '僅限已登入的婚禮管理員查詢桌次';
  END IF;

  RETURN QUERY
  SELECT
    g.actual_table_number,
    g.name::text,
    COALESCE(g.expected_count,0)::integer,
    COALESCE(g.checked_in_count,0)::integer,
    COALESCE(g.checkin_status,false)::boolean
  FROM public.guests g
  WHERE g.actual_table_number BETWEEN 1 AND 30
    AND COALESCE(g.expected_count,0) > 0
    AND COALESCE(g.qr_enabled,false) = true
    AND COALESCE(g.attendance_status,'') <> '不出席'
  ORDER BY g.actual_table_number, g.name;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_wedding_table_guests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_wedding_table_guests() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_wedding_table_guests() TO authenticated;
