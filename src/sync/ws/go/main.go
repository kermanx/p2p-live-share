package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"sync"

	"github.com/gorilla/websocket"
)

type Client struct {
	conn   *websocket.Conn
	peerId string
	roomId string
}

var (
	rooms     = make(map[string]map[string]*Client)
	roomsLock sync.RWMutex
	upgrader  = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
	pathRegex = regexp.MustCompile(`^/([\w-]+)/([\w-]+)$`)
)

func main() {
	port := flag.String("port", "8080", "Port to listen on")
	portShort := flag.String("p", "8080", "Port to listen on (short)")
	hostname := flag.String("hostname", "localhost", "Hostname / interface to bind")
	help := flag.Bool("help", false, "Show help message and exit")
	helpShort := flag.Bool("h", false, "Show help message and exit (short)")

	flag.Parse()

	if *help || *helpShort {
		fmt.Println("p2p-live-share WebSocket signaling server")
		fmt.Println("")
		fmt.Println("Usage:")
		fmt.Println("  p2p-live-share-ws-server [options]")
		fmt.Println("")
		fmt.Println("Options:")
		fmt.Println("  -p, --port <number>       Port to listen on (default: 8080)")
		fmt.Println("      --hostname <host>     Hostname / interface to bind (default: localhost)")
		fmt.Println("  -h, --help               Show this help message and exit")
		fmt.Println("")
		fmt.Println("Examples:")
		fmt.Println("  p2p-live-share-ws-server")
		fmt.Println("  p2p-live-share-ws-server -p 9000")
		fmt.Println("  p2p-live-share-ws-server --port 9000 --hostname 0.0.0.0")
		os.Exit(0)
	}

	// Use the short flag value if the long one isn't set
	if flag.Lookup("port").Value.String() == "8080" && *portShort != "8080" {
		*port = *portShort
	}

	addr := fmt.Sprintf("%s:%s", *hostname, *port)

	log.Println("Starting WebSocket server with Go...")
	log.Printf("Listening on ws://%s/\n", addr)

	http.HandleFunc("/", handleConnection)

	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func handleConnection(w http.ResponseWriter, r *http.Request) {
	// Handle root path with GET request
	if r.Method == "GET" && r.URL.Path == "/" {
		roomsLock.RLock()
		roomCount := len(rooms)
		roomsLock.RUnlock()

		msg := fmt.Sprintf("P2P Live Share WebSocket Signaling Server. %d active room(s).", roomCount)
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte(msg))
		return
	}

	// Match path pattern /{roomId}/{peerId}
	matches := pathRegex.FindStringSubmatch(r.URL.Path)
	if matches == nil {
		http.NotFound(w, r)
		return
	}

	roomId := matches[1]
	peerId := matches[2]

	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade failed: %v", err)
		http.Error(w, "Upgrade failed", http.StatusInternalServerError)
		return
	}

	client := &Client{
		conn:   conn,
		peerId: peerId,
		roomId: roomId,
	}

	// Add client to room
	roomsLock.Lock()
	roomClients, exists := rooms[roomId]
	if !exists {
		roomClients = make(map[string]*Client)
		rooms[roomId] = roomClients
	}
	roomClients[peerId] = client
	roomsLock.Unlock()

	log.Printf("Peer %s joined room %s", peerId, roomId)

	// Send updated peer list to all clients in room
	sendUpdatePeers(roomId)

	// Handle messages from this client
	go handleClient(client)
}

func handleClient(client *Client) {
	defer func() {
		client.conn.Close()

		roomsLock.Lock()
		roomClients, exists := rooms[client.roomId]
		if exists {
			delete(roomClients, client.peerId)
			if len(roomClients) == 0 {
				delete(rooms, client.roomId)
				log.Printf("Room %s is now empty and has been removed.", client.roomId)
			} else {
				roomsLock.Unlock()
				sendUpdatePeers(client.roomId)
				roomsLock.Lock()
			}
		}
		roomsLock.Unlock()

		log.Printf("Peer %s left room %s", client.peerId, client.roomId)
	}()

	for {
		messageType, message, err := client.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		if err := processMessage(client, messageType, message); err != nil {
			log.Printf("Failed to process message: %v", err)
		}
	}
}

func processMessage(sender *Client, messageType int, message []byte) error {
	isBinary := messageType == websocket.BinaryMessage

	uplink, err := DeserializeUplink(message, isBinary)
	if err != nil {
		return fmt.Errorf("deserialize uplink: %w", err)
	}

	roomsLock.RLock()
	roomClients, exists := rooms[sender.roomId]
	if !exists {
		roomsLock.RUnlock()
		sender.conn.Close()
		return fmt.Errorf("room %s not found", sender.roomId)
	}

	// Prepare downlink message
	downlink := DownlinkMessageContent{
		Action:   uplink.Action,
		Data:     uplink.Data,
		PeerID:   sender.peerId,
		Metadata: uplink.Metadata,
	}

	downlinkData, isBinaryDownlink, err := SerializeDownlink(downlink)
	if err != nil {
		roomsLock.RUnlock()
		return fmt.Errorf("serialize downlink: %w", err)
	}

	downlinkMessageType := websocket.TextMessage
	if isBinaryDownlink {
		downlinkMessageType = websocket.BinaryMessage
	}

	// Determine target peers
	var targets []*Client
	if uplink.TargetPeers != nil {
		switch v := uplink.TargetPeers.(type) {
		case string:
			if client, ok := roomClients[v]; ok {
				targets = []*Client{client}
			}
		case []interface{}:
			for _, id := range v {
				if idStr, ok := id.(string); ok {
					if client, ok := roomClients[idStr]; ok {
						targets = append(targets, client)
					}
				}
			}
		}
	} else {
		// Broadcast to all clients in room
		for _, client := range roomClients {
			targets = append(targets, client)
		}
	}
	roomsLock.RUnlock()

	// Send message to target peers (exclude sender)
	for _, target := range targets {
		if target != sender {
			if err := target.conn.WriteMessage(downlinkMessageType, downlinkData); err != nil {
				log.Printf("Failed to send message to peer %s: %v", target.peerId, err)
			}
		}
	}

	return nil
}

func sendUpdatePeers(roomId string) {
	roomsLock.RLock()
	roomClients, exists := rooms[roomId]
	if !exists {
		roomsLock.RUnlock()
		return
	}

	// Collect peer IDs
	peerIds := make([]string, 0, len(roomClients))
	for peerId := range roomClients {
		peerIds = append(peerIds, peerId)
	}

	// Create clients slice for iteration
	clients := make([]*Client, 0, len(roomClients))
	for _, client := range roomClients {
		clients = append(clients, client)
	}
	roomsLock.RUnlock()

	// Prepare update message
	downlink := DownlinkMessageContent{
		Action: UpdatePeersAction,
		Data:   peerIds,
		PeerID: "server",
	}

	updateData, _, err := SerializeDownlink(downlink)
	if err != nil {
		log.Printf("Failed to serialize update peers message: %v", err)
		return
	}

	// Send to all clients in room
	for _, client := range clients {
		if err := client.conn.WriteMessage(websocket.TextMessage, updateData); err != nil {
			log.Printf("Failed to send update peers to %s: %v", client.peerId, err)
		}
	}
}
