<script lang="ts">
	import Modal from '../Modal.svelte';
	let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<Modal bind:open wide title="AI thread">
	<p>wide modal body</p>
</Modal>
