package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
)

// DataPayload can be either JSON data or binary data
type DataPayload interface{}

// UplinkMessageContent represents messages from client to server
type UplinkMessageContent struct {
	Action      string      `json:"action"`
	Data        DataPayload `json:"data,omitempty"`
	TargetPeers interface{} `json:"targetPeers,omitempty"` // string or []string
	Metadata    interface{} `json:"metadata,omitempty"`
}

// DownlinkMessageContent represents messages from server to client
type DownlinkMessageContent struct {
	Action   string      `json:"action"`
	Data     DataPayload `json:"data,omitempty"`
	PeerID   string      `json:"peerId"`
	Metadata interface{} `json:"metadata,omitempty"`
}

const UpdatePeersAction = "__update_peers__"

// SerializeDownlink serializes a downlink message to either JSON or binary format
func SerializeDownlink(content DownlinkMessageContent) ([]byte, bool, error) {
	if data, ok := content.Data.([]byte); ok && data != nil {
		// Binary data - use packBufferJSON
		tempContent := content
		tempContent.Data = nil
		return packBufferJSON(data, tempContent)
	}
	// JSON data
	jsonData, err := json.Marshal(content)
	return jsonData, false, err
}

// DeserializeUplink deserializes an uplink message from JSON or binary format
func DeserializeUplink(input []byte, isBinary bool) (*UplinkMessageContent, error) {
	if isBinary {
		buffer, metadata, err := unpackBufferJSON(input)
		if err != nil {
			return nil, err
		}
		var msg UplinkMessageContent
		if err := json.Unmarshal(metadata, &msg); err != nil {
			return nil, err
		}
		msg.Data = buffer
		return &msg, nil
	}

	var msg UplinkMessageContent
	if err := json.Unmarshal(input, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

// packBufferJSON packs binary data with JSON metadata
// Format: [4 bytes: metadata length (little endian)][metadata JSON][binary data]
func packBufferJSON(data []byte, metadata interface{}) ([]byte, bool, error) {
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return nil, false, err
	}

	metadataLen := uint32(len(metadataJSON))
	buf := new(bytes.Buffer)

	// Write metadata length (little endian)
	if err := binary.Write(buf, binary.LittleEndian, metadataLen); err != nil {
		return nil, false, err
	}

	// Write metadata JSON
	if _, err := buf.Write(metadataJSON); err != nil {
		return nil, false, err
	}

	// Write binary data
	if _, err := buf.Write(data); err != nil {
		return nil, false, err
	}

	return buf.Bytes(), true, nil
}

// unpackBufferJSON unpacks binary data with JSON metadata
func unpackBufferJSON(buffer []byte) ([]byte, []byte, error) {
	if len(buffer) < 4 {
		return nil, nil, errors.New("buffer too short")
	}

	// Read metadata length (little endian)
	metadataLen := binary.LittleEndian.Uint32(buffer[0:4])

	if len(buffer) < int(4+metadataLen) {
		return nil, nil, errors.New("buffer too short for metadata")
	}

	// Extract metadata JSON
	metadataJSON := buffer[4 : 4+metadataLen]

	// Extract binary data
	dataBuffer := buffer[4+metadataLen:]

	return dataBuffer, metadataJSON, nil
}
