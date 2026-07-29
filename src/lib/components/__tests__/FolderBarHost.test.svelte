<script lang="ts">
	import FolderBar from '../FolderBar.svelte';

	type Folder = { id: string; name: string; convs: string[] };
	type Item = { id: string; name: string };

	let {
		folders = $bindable([] as Folder[]),
		active = $bindable(null as string | null),
		items = [] as Item[],
		kind = 'c' as 'c' | 'r',
		itemNoun = 'chats'
	} = $props();
</script>

<FolderBar bind:folders bind:active {items} {kind} {itemNoun} />
<output data-testid="active">{active ?? ''}</output>
