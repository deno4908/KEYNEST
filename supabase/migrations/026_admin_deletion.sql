begin;
create function delete_admin_record(p_actor uuid, p_kind text, p_id text)
returns void language plpgsql set search_path=public as $$
begin
 perform 1 from profiles where id=p_actor and role='admin' for update;
 if not found then raise exception 'Cần quyền quản trị.'; end if;
 if p_kind='category' then
  perform 1 from categories where id=p_id for update;
  if not found then raise exception 'Không tìm thấy danh mục.'; end if;
  if exists(select 1 from products where category=p_id) or exists(select 1 from coupons where category=p_id) then
   raise exception 'Danh mục còn sản phẩm hoặc mã giảm giá. Hãy chuyển chúng sang danh mục khác trước khi xóa.';
  end if;
  delete from categories where id=p_id;
 elsif p_kind='coupon' then
  perform 1 from coupons where code=p_id for update;
  if not found then raise exception 'Không tìm thấy mã giảm giá.'; end if;
  if exists(select 1 from orders where coupon=p_id) then
   raise exception 'Mã đã gắn với đơn hàng. Hãy tắt mã để giữ lịch sử sử dụng.';
  end if;
  delete from coupons where code=p_id;
 elsif p_kind='banner' then
  delete from banners where id=p_id::uuid;
  if not found then raise exception 'Không tìm thấy banner.'; end if;
 else raise exception 'Thao tác không hợp lệ.';
 end if;
 insert into audit_logs(user_id,action,target) values(p_actor,'delete_'||p_kind,p_id);
end $$;
revoke all on function delete_admin_record(uuid,text,text) from public,anon,authenticated;
grant execute on function delete_admin_record(uuid,text,text) to service_role;
commit;
