<script lang="ts">
	import Page from '../+page.svelte';
	let { data = { user: { id: 'me', username: 'me' } } } = $props();
</script>

<Page {data} />
