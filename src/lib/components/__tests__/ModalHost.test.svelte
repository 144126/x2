<script lang="ts">
	import Modal from '../Modal.svelte';
	let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<Modal bind:open title="edit folder">
	<p>modal body</p>
</Modal>
