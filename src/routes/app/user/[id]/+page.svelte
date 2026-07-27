<script lang="ts">
	import { goto } from '$app/navigation';
	import type { User } from '$lib/types';
	let { data } = $props();
	let u = $state(data.u as User);
</script>

<section class="prof reveal mx-auto max-w-[560px]">
	<div class="eyebrow">user</div>
	<h1 class="display mt-3 mb-10 text-[clamp(40px,6vw,64px)]">{u.n}</h1>

	<button class="btn btn-amber" onclick={() => goto('/app/chat/' + data.id)}>chat</button>
</section>
