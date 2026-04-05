class VoiceManager {
    constructor(gameClient) {
        this.client = gameClient;
        this.localStream = null;
        this.peers = new Map(); // playerId -> RTCPeerConnection
        this.isMuted = true;
        this.pendingCandidates = new Map(); // playerId -> Array<RTCIceCandidate>
    }

    async init() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            this.setMute(true); // Start muted
            console.log('Voice chat initialized');
            return true;
        } catch (e) {
            console.error('Failed to get microphone access:', e);
            this.client.addChatMessage('System: Failed to access microphone for voice chat.', true);
            return false;
        }
    }

    toggleMute() {
        if (!this.localStream) {
            this.init().then(success => {
                if (success) {
                    this.setMute(false);
                    this.client.addChatMessage('Voice Chat: ON (Mic Active)', true);
                }
            });
            return;
        }

        this.isMuted = !this.isMuted;
        this.setMute(this.isMuted);
        const status = this.isMuted ? 'OFF (Muted)' : 'ON (Mic Active)';
        this.client.addChatMessage(`Voice Chat: ${status}`, true);
    }

    setMute(muted) {
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => track.enabled = !muted);
            this.isMuted = muted;
        }
    }

    createPeerConnection(targetId, isInitiator) {
        if (this.peers.has(targetId)) return this.peers.get(targetId);

        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        this.peers.set(targetId, pc);

        // Add local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
        }

        // Handle incoming stream
        pc.ontrack = (event) => {
            const remoteAudio = new Audio();
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.autoplay = true;
            console.log(`Receiving audio from ${targetId}`);
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.client.send({
                    type: 'voice-signal',
                    targetId: targetId,
                    signal: { type: 'candidate', candidate: event.candidate }
                });
            }
        };

        // If initiator, create offer
        if (isInitiator) {
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                    this.client.send({
                        type: 'voice-signal',
                        targetId: targetId,
                        signal: { type: 'offer', sdp: pc.localDescription }
                    });
                })
                .catch(e => console.error('Error creating offer:', e));
        }

        return pc;
    }

    async handleSignal(data) {
        const { senderId, signal } = data;
        let pc = this.peers.get(senderId);

        if (!pc) {
            // If we receive an offer, we are not the initiator
            if (signal.type === 'offer') {
                pc = this.createPeerConnection(senderId, false);
            } else {
                console.warn('Received signal for unknown peer:', senderId);
                return;
            }
        }

        try {
            if (signal.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.client.send({
                    type: 'voice-signal',
                    targetId: senderId,
                    signal: { type: 'answer', sdp: pc.localDescription }
                });
            } else if (signal.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            } else if (signal.type === 'candidate') {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
        } catch (e) {
            console.error('Error handling signal:', e);
        }
    }

    removePeer(peerId) {
        const pc = this.peers.get(peerId);
        if (pc) {
            pc.close();
            this.peers.delete(peerId);
        }
    }
}

// Expose globally
window.VoiceManager = VoiceManager;
