/*
net-glimpse
Created by Kristian Lange on 2017.
*/

var netDataReceiver = {};

(function () {

  // Start WebSocket to get a stream of network package header data
  netDataReceiver.start = function () {
    var nif = getUrlQueryParameterByName("nif");
    var urlQueryStr = (nif) ? "?nif=" + nif : "";
    var socket = new WebSocket(
      ((window.location.protocol === "https:") ? "wss://" : "ws://") +
      window.location.host + "/netdata" + urlQueryStr);

    socket.onmessage = function (event) {
      var packet = JSON.parse(event.data);
      if (packet.ethernet && typeof graphEther !== 'undefined' &&
        isInEtherWhitelistAndNotInEtherBlacklist(packet)) {
        graphEther.fill(getParameterForEtherVisu(packet));
      }
      if (packet.ip && typeof graphIp !== 'undefined' &&
        isInIpWhitelistAndNotInIpBlacklist(packet)) {
        graphIp.fill(getParameterForIPVisu(packet));
      }
    }
  }

  function getParameterForEtherVisu(packet) {
    var para = {};
    para.srcAddr = packet.ethernet.macSrcAddr;
    para.dstAddr = packet.ethernet.macDstAddr;
    para.srcNodeColor = getColorFromMac(para.srcAddr);
    para.dstNodeColor = getColorFromMac(para.dstAddr);
    var etherType = packet.ethernet.etherType;
    if (etherTypeConfig[etherType]) {
      para.edgeColor = etherTypeConfig[etherType].color;
      para.edgeText = etherTypeConfig[etherType].name;
    } else {
      para.edgeColor = etherTypeConfig["unknown"].color;
      para.edgeText = etherType;
    }
    return para;
  }

  function getParameterForIPVisu(packet) {
    var para = {};

    para.srcAddr = packet.ip.srcAddr;
    para.dstAddr = packet.ip.dstAddr;

    if (packet.ip.version === "IPv4") {
      para.srcNodeColor = getColorFromIPv4(para.srcAddr);
      para.dstNodeColor = getColorFromIPv4(para.dstAddr);
    } else if (packet.ip.version === "IPv6") {
      para.srcNodeColor = getColorFromIPv6(para.srcAddr);
      para.dstNodeColor = getColorFromIPv6(para.dstAddr);
    }
    // Multicast address's nodes are white (broadcast are already white)
    if (packet.ip.dstIsMc === true) {
      para.dstNodeColor = [255, 255, 255];
    }

    fillIpEdgeColorAndText(packet, para);
    return para;
  }

  function fillIpEdgeColorAndText(packet, para) {
    if (packet.tcp) {
      var srcPort = packet.tcp.srcPort;
      var dstPort = packet.tcp.dstPort;
      fillIpEdgeColorAndTextWithConfigData(srcPort, dstPort, para);
    } else if (packet.udp) {
      var srcPort = packet.udp.srcPort;
      var dstPort = packet.udp.dstPort;
      fillIpEdgeColorAndTextWithConfigData(srcPort, dstPort, para);
    }

    // If it's not a TCP or UDP packet show the protocol name as text
    if (!para.edgeText) {
      para.edgeText = packet.ip.protocol;
    }
    if (!para.edgeColor) {
      para.edgeColor = ipPacketConfig["unknown"].color;
    }
  }

  function fillIpEdgeColorAndTextWithConfigData(srcPort, dstPort, para) {
    // Always show port names (instead of numbers) if the port is in configIp and configIp.edges.showPortNames is true
    if (configIp.edge.showPortNames) {
      if (ipPacketConfig[srcPort]) {
        // Show src port name like specified in ipPacketConfig
        para.edgeText = ipPacketConfig[srcPort].name;
        para.edgeColor = ipPacketConfig[srcPort].color;
        return;
      }
      if (ipPacketConfig[dstPort]) {
        // Show dst port name like specified in ipPacketConfig
        para.edgeText = ipPacketConfig[dstPort].name;
        para.edgeColor = ipPacketConfig[dstPort].color;
        return;
      }
    }

    // Show port numbers if configured in configIp
    var srcPortText = getPortText(srcPort);
    var dstPortText = getPortText(dstPort);
    if (srcPortText !== null && dstPortText !== null) {
      para.edgeText = srcPortText + ":" + dstPortText;
      para.edgeColor = ipPacketConfig["unknown"].color;
    } else if (srcPortText !== null && dstPortText === null) {
      para.edgeText = srcPortText;
      para.edgeColor = ipPacketConfig["unknown"].color;
    } else if (srcPortText === null && dstPortText !== null) {
      para.edgeText = dstPortText;
      para.edgeColor = ipPacketConfig["unknown"].color;
    } else {
      para.edgeText = "";
      para.edgeColor = ipPacketConfig["unknown"].color;
    }
  }

  function getPortText(port) {
    if ((configIp.edge.showWellKnownPorts && port < 1024) ||
      (configIp.edge.showRegisteredPorts && port >= 1024 && port < 49152) ||
      (configIp.edge.showOtherPorts && port >= 49152)) {
      return port;
    } else {
      return null;
    }
  }

  function getColorFromMac(macAddr) {
    var addrArray = macAddr.split(":");
    var color = [];
    color[0] = (parseInt(addrArray[0], 16) + parseInt(addrArray[3], 16)) / 2;
    color[1] = (parseInt(addrArray[1], 16) + parseInt(addrArray[4], 16)) / 2;
    color[2] = (parseInt(addrArray[2], 16) + parseInt(addrArray[5], 16)) / 2;
    return color;
  }

  function getColorFromIPv4(addr) {
    var addrArray = addr.split(".");
    var color = [];
    color[0] = (parseInt(addrArray[0]) + parseInt(addrArray[1])) / 2;
    color[1] = (parseInt(addrArray[1]) + parseInt(addrArray[2])) / 2;
    color[2] = (parseInt(addrArray[2]) + parseInt(addrArray[3])) / 2;
    return color;
  }

  function getColorFromIPv6(addr) {
    return intToColor(hashCode(addr));
  }

  function hashCode(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash;
  }

  function intToColor(i) {
    var color = [];
    color[0] = ((i >> 24) & 0xFF);
    color[1] = ((i >> 16) & 0xFF);
    color[2] = ((i >> 8) & 0xFF);
    return color;
  }

  // Check if the src AND dst MAC address is not in the blacklist and
  // check if the src OR dst address is in the whitelist - but only if the whitelist has at least one element.
  // If the whitelist has no element it is ignored.
  function isInEtherWhitelistAndNotInEtherBlacklist(packet) {
    var srcAddr = packet.ethernet.macSrcAddr;
    var dstAddr = packet.ethernet.macDstAddr;
    return !isInList(srcAddr, etherBlacklist) && !isInList(dstAddr, etherBlacklist) &&
      (etherWhitelist.length === 0 || isInList(srcAddr, etherWhitelist) || isInList(dstAddr, etherWhitelist))  ;
  }

  // Check if the src AND dst Internet address (format 'IP:port') is not in the blacklist and
  // check if the src OR dst address is in the whitelist - but only if the whitelist has at least one element.
  // If the whitelist has no element it is ignored.
  function isInIpWhitelistAndNotInIpBlacklist(packet) {
    var srcAddr;
    var dstAddr
    if (packet.tcp) {
      srcAddr = packet.ip.srcAddr + ":" + packet.tcp.srcPort;
      dstAddr = packet.ip.dstAddr + ":" + packet.tcp.dstPort;
    } else if (packet.udp) {
      srcAddr = packet.ip.srcAddr + ":" + packet.udp.srcPort;
      dstAddr = packet.ip.dstAddr + ":" + packet.udp.dstPort;
    } else {
      srcAddr = packet.ip.srcAddr;
      dstAddr = packet.ip.dstAddr;
    }
    return !isInList(srcAddr, ipBlacklist) && !isInList(dstAddr, ipBlacklist) &&
      (ipWhitelist.length === 0 || isInList(srcAddr, ipWhitelist) || isInList(dstAddr, ipWhitelist));
  }

  // Evalutates all elements of an array of regexes if they fulfill the given addr
  // Used for whitelists and blacklists
  function isInList(addr, regexArray) {
    return regexArray.some(function (regexp) {
      return regexp.test(addr);
    });
  }

})();