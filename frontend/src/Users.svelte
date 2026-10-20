<script lang="ts">
 import {onMount} from 'svelte';
 import {api} from './api';import type {User} from './types';
 let {onerror}:{onerror:(e:unknown)=>void}=$props();
 let users=$state<User[]>([]);let username=$state('');let password=$state('');let resets=$state<Record<number,string>>({});let busy=$state(false);let notice=$state('');
 async function load(){try{users=await api<User[]>('/admin/users')}catch(e){onerror(e)}}
 onMount(load);
 async function create(){busy=true;try{await api('/admin/users','POST',{username,password});username='';password='';notice='账号已创建';await load()}catch(e){onerror(e)}finally{busy=false}}
 async function update(id:number,data:unknown){busy=true;try{await api(`/admin/users/${id}`,'PATCH',data);resets[id]='';notice='账号已更新，旧会话已撤销';await load()}catch(e){onerror(e)}finally{busy=false}}
</script>
<section class="settings"><span class="eyebrow">站点管理</span><h2>账号管理</h2><p class="muted">站点管理员不自动拥有私人看板权限。新账号使用用户名与密码登录。</p>{#if notice}<p class="success" role="status">{notice}</p>{/if}
<form class="user-create" onsubmit={e=>{e.preventDefault();void create()}}><label>新用户名<input aria-label="新用户名" bind:value={username} required pattern="[A-Za-z0-9_.-]+" maxlength="64" autocomplete="off"/></label><label>初始密码<input aria-label="初始密码" type="password" bind:value={password} required minlength="12" maxlength="256" autocomplete="new-password"/></label><button class="primary" disabled={busy}>创建账号</button></form>
<div class="users">{#each users as user}<article class="user-row"><div><strong>{user.username}</strong><span class="muted">{user.is_admin?'站点管理员':user.active?'活跃账号':'已停用'}</span></div><form onsubmit={e=>{e.preventDefault();void update(user.id,{password:resets[user.id]})}}><input aria-label={`为${user.username}重置密码`} type="password" placeholder="新密码（至少12位）" minlength="12" required bind:value={resets[user.id]} autocomplete="new-password"/><button disabled={busy}>重置密码</button></form>{#if !user.is_admin}<button class="secondary" disabled={busy} onclick={()=>update(user.id,{active:!user.active})}>{user.active?'停用':'启用'}</button>{/if}</article>{/each}</div>
</section>
